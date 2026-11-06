import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  STREAM_ACTIVE_STATUSES,
  STREAM_WITHDRAWABLE_STATUSES,
  classifyCasterExit,
  findOutstandingPostCast,
  formatScheduleForDiscord,
  normalizeWithdrawalReason,
  postCastFormLink,
  validateDenialReason,
  validateSocialUrl,
  validateStreamRequest,
  validateStreamUrl
} from '../src/streamRequest.js';
import {
  HttpWebsitePublisher,
  LogOnlyWebsitePublisher,
  buildWebsitePayload,
  createWebsitePublisher
} from '../src/websitePublisher.js';

const quietLog = { info() {}, warn() {}, error() {} };

test('a caster leaving a pending request is a cancel; leaving an approved cast is a withdrawal', () => {
  const now = new Date('2026-11-02T12:00:00Z');
  assert.deepEqual(classifyCasterExit({ status: 'pending' }, now), { kind: 'cancel', late: false, hoursUntilMatch: null });
  assert.equal(classifyCasterExit({ status: 'denied' }, now), null);
  assert.equal(classifyCasterExit(null, now), null);
  for (const status of STREAM_WITHDRAWABLE_STATUSES) {
    assert.equal(classifyCasterExit({ status }, now).kind, 'withdraw');
  }

  const soon = classifyCasterExit({ status: 'approved', faceitScheduledAtIso: '2026-11-02T20:00:00Z' }, now);
  assert.equal(soon.late, true);
  assert.equal(Math.round(soon.hoursUntilMatch), 8);

  const later = classifyCasterExit({ status: 'approved', faceitScheduledAtIso: '2026-11-05T20:00:00Z' }, now);
  assert.equal(later.late, false);

  const unscheduled = classifyCasterExit({ status: 'approved' }, now);
  assert.deepEqual(unscheduled, { kind: 'withdraw', late: false, hoursUntilMatch: null });
});

test('post-cast form links pre-fill the request ID when the template allows it', () => {
  const template = 'https://docs.google.com/forms/d/e/abc/viewform?usp=pp_url&entry.104948941={requestId}';
  assert.equal(postCastFormLink(template, 'https://forms.gle/x', 'SR-12 a'), 'https://docs.google.com/forms/d/e/abc/viewform?usp=pp_url&entry.104948941=SR-12%20a');
  assert.equal(postCastFormLink('https://forms.gle/plain', 'https://forms.gle/x', 'SR-1'), 'https://forms.gle/x');
  assert.equal(postCastFormLink(null, 'https://forms.gle/x', 'SR-1'), 'https://forms.gle/x');
  assert.equal(postCastFormLink(template, null, null), template);
});

test('only the most recent finished cast without a form response blocks a caster', () => {
  const me = 'caster-1';
  const requests = [
    { id: 'OLD', requesterId: me, status: 'approved', postCastReminderSentAt: '2026-10-01T00:00:00Z' },
    { id: 'A', requesterId: me, status: 'approved', postCastReminderSentAt: '2026-11-03T00:00:00Z' },
    { id: 'B', requesterId: me, status: 'approved', postCastReminderSentAt: '2026-11-05T00:00:00Z' },
    { id: 'PENDING', requesterId: me, status: 'pending' },
    { id: 'UPCOMING', requesterId: me, status: 'approved' },
    { id: 'OTHER', requesterId: 'someone-else', status: 'approved', postCastReminderSentAt: '2026-11-06T00:00:00Z' }
  ];
  const since = '2026-11-02T00:00:00Z';
  assert.equal(findOutstandingPostCast(requests, { requesterId: me, since })?.id, 'B');

  const bDone = requests.map((request) => (request.id === 'B' ? { ...request, postCastFormSubmittedAt: '2026-11-05T02:00:00Z' } : request));
  assert.equal(findOutstandingPostCast(bDone, { requesterId: me, since }), null, 'an older unfilled form does not block once the latest one is in');

  const bWaived = requests.map((request) => (request.id === 'B' ? { ...request, postCastFormWaivedAt: '2026-11-05T02:00:00Z' } : request));
  assert.equal(findOutstandingPostCast(bWaived, { requesterId: me, since }), null);

  assert.equal(findOutstandingPostCast([requests[0]], { requesterId: me, since }), null, 'casts before the cutoff are exempt');
  assert.equal(findOutstandingPostCast([requests[0]], { requesterId: me }).id, 'OLD', 'no cutoff means every finished cast counts');
  assert.equal(findOutstandingPostCast([], { requesterId: me, since }), null);
});

test('withdrawal reasons are trimmed, defaulted and capped', () => {
  assert.equal(normalizeWithdrawalReason('   '), 'No reason given');
  assert.equal(normalizeWithdrawalReason('  got  sick\n\ntoday '), 'got sick today');
  assert.equal(normalizeWithdrawalReason('x'.repeat(600)).length, 500);
});

test('stream links accept Twitch, YouTube and Kick channels and record the platform', () => {
  assert.deepEqual(validateStreamUrl('https://twitch.tv/example'), { valid: true, value: 'https://twitch.tv/example', platform: 'twitch' });
  assert.equal(validateStreamUrl('https://www.twitch.tv/Example/videos?filter=all').value, 'https://twitch.tv/example');
  assert.equal(validateStreamUrl('https://www.youtube.com/@Example/live').value, 'https://www.youtube.com/@Example');
  assert.equal(validateStreamUrl('www.youtube.com/@example').platform, 'youtube');
  assert.match(validateStreamUrl('https://youtube.com/watch?v=abc123').error, /channel page/);
  assert.equal(validateStreamUrl('https://kick.com/example').platform, 'kick');
  assert.equal(validateStreamUrl('twitch.tv/example').value, 'https://twitch.tv/example');
});

test('stream links reject other hosts, bare homepages, and disallowed platforms', () => {
  assert.equal(validateStreamUrl('https://example.com/live').valid, false);
  assert.match(validateStreamUrl('https://twitch.tv/').error, /homepage/);
  assert.match(validateStreamUrl('https://www.twitch.tv/search?term=OmenEsportsCS2').error, /not a search, directory or video link\. Example: https:\/\/twitch\.tv\/yourchannel/);
  assert.equal(validateStreamUrl('https://www.twitch.tv/directory/category/counter-strike').valid, false);
  assert.equal(validateStreamUrl('https://kick.com/categories/counter-strike-2').valid, false);
  assert.equal(validateStreamUrl('https://youtu.be/abc123').valid, false);
  assert.match(validateStreamUrl('https://kick.com/example', ['twitch']).error, /twitch\.tv/);
  assert.equal(validateStreamUrl('not a url').valid, false);
});

test('social links must be an X or Twitter profile', () => {
  assert.equal(validateSocialUrl('https://x.com/example').valid, true);
  assert.equal(validateSocialUrl('mobile.twitter.com/example').valid, true);
  assert.match(validateSocialUrl('https://x.com/home').error, /profile/);
  assert.equal(validateSocialUrl('https://instagram.com/example').valid, false);
});

test('denial reasons are bounded and shown to the caster', () => {
  assert.equal(validateDenialReason('nope').valid, false);
  assert.equal(validateDenialReason('x'.repeat(401)).valid, false);
  assert.deepEqual(validateDenialReason('  Another caster already covers this match.  '), { valid: true, value: 'Another caster already covers this match.' });
});

test('stream request validation reports every problem at once and keeps the platform', () => {
  const invalid = validateStreamRequest({
    matchDetailsRequired: false,
    streamUrl: 'https://example.com',
    socialUrl: 'https://x.com/explore'
  });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.errors.length, 2);

  const valid = validateStreamRequest({
    matchDetailsRequired: false,
    streamUrl: 'https://kick.com/example',
    socialUrl: 'https://x.com/example'
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.value.streamPlatform, 'kick');
});

test('Discord schedule formatting uses native timestamps with a fallback', () => {
  const formatted = formatScheduleForDiscord('2026-11-04T19:00:00.000Z');
  const unix = Math.floor(Date.parse('2026-11-04T19:00:00.000Z') / 1000);
  assert.match(formatted, new RegExp(`^<t:${unix}:F> \\(<t:${unix}:R>\\)`));
  assert.equal(formatScheduleForDiscord(null, 'TBD'), 'TBD');
});

test('website payload carries event, match, stream and status data', () => {
  const payload = buildWebsitePayload({
    id: 'stream-1',
    status: 'approving',
    matchup: 'Alpha vs Bravo',
    matchId: '1-abc',
    faceitUrl: 'https://www.faceit.com/en/cs2/room/1-abc',
    faceitLinkValid: true,
    faceitStatus: 'SCHEDULED',
    faceitScheduledAtIso: '2026-11-04T19:00:00.000Z',
    streamUrl: 'https://twitch.tv/example',
    streamPlatform: 'twitch',
    requesterId: '42',
    requesterTag: 'caster#0001',
    socialUrl: 'https://x.com/example',
    reviewedAt: '2026-10-30T15:41:12.000Z',
    reviewedBy: '7'
  });
  assert.equal(payload.status, 'approved');
  assert.equal(payload.event.starts_at, '2026-11-04T19:00:00.000Z');
  assert.deepEqual([payload.match.team_a, payload.match.team_b], ['Alpha', 'Bravo']);
  assert.equal(payload.stream.caster.discord_id, '42');
  assert.equal(payload.approved_by_discord_id, '7');
  assert.equal(buildWebsitePayload({ id: 'x', status: 'approved' }, { status: 'revoked' }).status, 'revoked');
});

test('log-only publisher is selected without an endpoint and reports success', async () => {
  const publisher = createWebsitePublisher({ websiteEndpoint: null }, { log: quietLog });
  assert.ok(publisher instanceof LogOnlyWebsitePublisher);
  const result = await publisher.publish({ id: 'stream-9', status: 'approving', streamUrl: 'https://twitch.tv/x', socialUrl: 'https://x.com/x', requesterId: '1' });
  assert.deepEqual(result, { ok: true, websiteId: 'local-stream-9', error: null });
});

function fakeFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return { status: next.status, text: async () => next.body ?? '' };
  };
  return { fetchImpl, calls };
}

const request = { id: 'stream-2', status: 'approving', matchup: 'Alpha vs Bravo', streamUrl: 'https://twitch.tv/x', socialUrl: 'https://x.com/x', requesterId: '1' };

test('HTTP publisher sends a bearer token and idempotency key and keeps the returned id', async () => {
  const { fetchImpl, calls } = fakeFetch([{ status: 201, body: '{"id":"site-77"}' }]);
  const publisher = new HttpWebsitePublisher({ endpoint: 'https://site.test/hook', apiKey: 'k', timeoutMs: 1000, maxAttempts: 3, fetchImpl, log: quietLog, sleep: async () => {} });
  const result = await publisher.publish(request);
  assert.deepEqual(result, { ok: true, websiteId: 'site-77', error: null });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer k');
  assert.equal(calls[0].init.headers['Idempotency-Key'], 'caster-request-stream-2');
  assert.equal(JSON.parse(calls[0].init.body).request_id, 'stream-2');
});

test('HTTP publisher retries 5xx and network errors but not other 4xx', async () => {
  const retried = fakeFetch([{ status: 503, body: 'down' }, new Error('socket hang up'), { status: 200, body: 'ok' }]);
  const publisher = new HttpWebsitePublisher({ endpoint: 'https://site.test/hook', apiKey: 'k', timeoutMs: 1000, maxAttempts: 3, fetchImpl: retried.fetchImpl, log: quietLog, sleep: async () => {} });
  assert.equal((await publisher.publish(request)).ok, true);
  assert.equal(retried.calls.length, 3);

  const rejected = fakeFetch([{ status: 400, body: 'bad payload' }]);
  const strict = new HttpWebsitePublisher({ endpoint: 'https://site.test/hook', apiKey: 'k', timeoutMs: 1000, maxAttempts: 3, fetchImpl: rejected.fetchImpl, log: quietLog, sleep: async () => {} });
  const failure = await strict.publish(request);
  assert.equal(failure.ok, false);
  assert.match(failure.error, /HTTP 400: bad payload/);
  assert.equal(rejected.calls.length, 1);

  const exhausted = fakeFetch([{ status: 500 }, { status: 502 }, { status: 504 }]);
  const giveUp = new HttpWebsitePublisher({ endpoint: 'https://site.test/hook', apiKey: 'k', timeoutMs: 1000, maxAttempts: 3, fetchImpl: exhausted.fetchImpl, log: quietLog, sleep: async () => {} });
  const final = await giveUp.publish(request);
  assert.equal(final.ok, false);
  assert.match(final.error, /HTTP 504/);
  assert.equal(exhausted.calls.length, 3);
});

async function freshStore(label) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `crossfire-${label}-`));
  process.env.BOT_DATA_PATH = path.join(tempDir, 'bot-data.json');
  const store = await import(`../src/store.js?${label}=${Date.now()}`);
  return { store, tempDir };
}

test('approval is claimed atomically and publish results move it to approved or publish_failed', async () => {
  const { store, tempDir } = await freshStore('approve');
  await store.createStreamRequest({ id: 'req-1', requesterId: 'user', matchup: 'Alpha vs Bravo' });
  const claims = await Promise.all([store.claimStreamApproval('req-1', 'staff-a'), store.claimStreamApproval('req-1', 'staff-b')]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal((await store.getStreamRequest('req-1')).status, 'approving');

  const failed = await store.recordStreamPublishResult('req-1', { ok: false, error: 'HTTP 503' });
  assert.equal(failed.status, 'publish_failed');
  assert.equal(failed.publishAttempts, 1);
  assert.equal(failed.lastPublishError, 'HTTP 503');
  assert.equal(await store.claimStreamApproval('req-1', 'staff-a'), null);

  assert.equal((await store.claimStreamRepublish('req-1', 'staff-a')).status, 'approving');
  const published = await store.recordStreamPublishResult('req-1', { ok: true, websiteId: 'site-1' });
  assert.equal(published.status, 'approved');
  assert.equal(published.publishAttempts, 2);
  assert.equal(published.websiteId, 'site-1');
  assert.equal(published.lastPublishError, null);
  assert.ok(published.websitePublishedAt);
  assert.equal(await store.recordStreamPublishResult('req-1', { ok: true }), null);
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('interrupted publishes are recovered on startup and unposted requests are listed', async () => {
  const { store, tempDir } = await freshStore('recover');
  await store.createStreamRequest({ id: 'stuck', requesterId: 'user', status: 'approving' });
  await store.createStreamRequest({ id: 'unposted', requesterId: 'user-2' });
  await store.createStreamRequest({ id: 'legacy', requesterId: 'user-3', status: 'submission_failed' });
  await store.createStreamRequest({ id: 'posted', requesterId: 'user-4', staffMessageId: '123' });

  const recovered = await store.recoverInterruptedStreamPublishes();
  assert.deepEqual(recovered.map((entry) => entry.id), ['stuck']);
  assert.equal(recovered[0].status, 'publish_failed');
  assert.match(recovered[0].lastPublishError, /restarted/);

  const awaiting = (await store.listStreamRequestsAwaitingStaffPost()).map((entry) => entry.id).sort();
  assert.deepEqual(awaiting, ['legacy', 'unposted']);
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('publish_failed and approving requests still block duplicate submissions per caster', async () => {
  const { store, tempDir } = await freshStore('active');
  assert.deepEqual(STREAM_ACTIVE_STATUSES, ['pending', 'approving', 'approved', 'publish_failed']);
  const base = { requesterId: 'caster', matchId: 'match-1' };
  await store.createStreamRequest({ ...base, id: 'first', status: 'publish_failed' });
  const duplicate = await store.createStreamRequestUnlessActive({ ...base, id: 'second' });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.request.id, 'first');
  const otherCaster = await store.createStreamRequestUnlessActive({ ...base, requesterId: 'other', id: 'third' });
  assert.equal(otherCaster.created, true);
  await fs.rm(tempDir, { recursive: true, force: true });
});
