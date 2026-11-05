import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStreamListView, isPostCastFormOverdue } from '../src/streamRequest.js';

const NOW = Date.parse('2026-11-05T18:00:00Z');
const hours = (count) => count * 60 * 60 * 1000;

function req(id, status, startIso, extra = {}) {
  return { id, status, requesterId: '1', matchup: `${id} vs X`, faceitScheduledAtIso: startIso, ...extra };
}

test('the list groups active requests and gives each website failure a Retry button', () => {
  const view = buildStreamListView([
    req('later', 'approved', '2026-11-07T01:00:00Z'),
    req('soon', 'approved', '2026-11-06T01:00:00Z'),
    req('waiting', 'pending', '2026-11-06T02:00:00Z'),
    req('approving', 'approving', null),
    req('web', 'publish_failed', '2026-11-06T03:00:00Z'),
    req('done', 'approved', '2026-11-04T01:00:00Z', { terminalNotifiedAt: '2026-11-04T03:00:00Z' }),
    req('stale', 'approved', '2026-11-05T01:00:00Z'),
    req('old-web', 'publish_failed', '2026-11-01T01:00:00Z'),
    req('denied', 'denied', '2026-11-06T01:00:00Z'),
    req('withdrawn', 'withdrawn', '2026-11-06T01:00:00Z')
  ], { now: NOW });
  const text = view.description;
  assert.match(text, /\*\*Waiting for review \(2\)\*\*\n`waiting` \*\*waiting vs X\*\* · <@1> · <t:\d+:f>\n`approving` \*\*approving vs X\*\* · <@1> · not scheduled/);
  assert.match(text, /\*\*Approved \(2\)\*\*\n`soon` .*\n`later` /);
  assert.match(text, /\*\*⚠️ Not on the website \(1\)\*\*\nApproved, but the website did not accept them\. Press Retry to publish again\.\n`web` /);
  assert.doesNotMatch(text, /done vs|stale vs|old-web|denied|withdrawn/);
  assert.deepEqual(view.retryIds, ['web']);
});

test('the list says so when nothing is active and caps long sections', () => {
  assert.deepEqual(buildStreamListView([], { now: NOW }), { description: 'No active stream requests.', retryIds: [] });
  const many = Array.from({ length: 20 }, (_, index) => req(`p${index}`, 'pending', null));
  assert.match(buildStreamListView(many, { now: NOW }).description, /…and 5 more/);
});

test('an approved cast gets the post-cast form 12 hours after its match time if FACEIT never finished it', () => {
  const since = '2026-11-02T00:00:00Z';
  const start = '2026-11-05T01:00:00Z';
  const cast = req('c', 'approved', start);
  assert.equal(isPostCastFormOverdue(cast, { now: Date.parse(start) + hours(11), since }), false);
  assert.equal(isPostCastFormOverdue(cast, { now: Date.parse(start) + hours(12), since }), true);
  assert.equal(isPostCastFormOverdue({ ...cast, postCastReminderSentAt: 'x' }, { now: NOW, since }), false);
  assert.equal(isPostCastFormOverdue({ ...cast, faceitStatus: 'CANCELLED' }, { now: NOW, since }), false);
  assert.equal(isPostCastFormOverdue({ ...cast, status: 'withdrawn' }, { now: NOW, since }), false);
  assert.equal(isPostCastFormOverdue({ ...cast, faceitScheduledAtIso: null, dateTimeIso: null }, { now: NOW, since }), false);
  assert.equal(isPostCastFormOverdue(req('old', 'approved', '2026-10-01T01:00:00Z'), { now: NOW, since }), false, 'casts before the cutoff are left alone');
});
