import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLiveBoardNotice, isBroadcastLive, shouldAutoEndBroadcast } from '../src/streamRequest.js';

const base = {
  id: 'stream-xyz',
  status: 'approved',
  matchup: 'Alpha vs Bravo',
  requesterId: '123',
  requesterTag: 'caster#0001',
  streamUrl: 'https://twitch.tv/caster',
  streamPlatform: 'twitch',
  faceitUrl: 'https://www.faceit.com/en/cs2/room/1-abc',
  faceitScheduledAtIso: '2026-11-05T01:00:00.000Z',
  liveStartedAt: '2026-11-05T01:02:00.000Z'
};

test('isBroadcastLive is true between start and end only', () => {
  assert.equal(isBroadcastLive({}), false);
  assert.equal(isBroadcastLive(base), true);
  assert.equal(isBroadcastLive({ ...base, liveEndedAt: '2026-11-05T03:00:00.000Z' }), false);
});

test('live board notice names the caster and never mentions anyone', () => {
  const notice = buildLiveBoardNotice(base);
  assert.equal(notice.title, '🔴 LIVE: Alpha vs Bravo');
  assert.match(notice.description, /caster#0001/);
  assert.doesNotMatch(JSON.stringify(notice), /<@/);
  assert.equal(notice.fields.find((field) => field.name === 'Watch (twitch)').value, base.streamUrl);
  assert.match(notice.fields.find((field) => field.name === 'Started').value, /^<t:\d+:R>$/);
});

test('auto-end fires when the match ended long ago or the request is no longer approved', () => {
  const now = new Date('2026-11-05T06:00:00.000Z');
  assert.equal(shouldAutoEndBroadcast(base, now), false, 'no terminal state yet');
  assert.equal(shouldAutoEndBroadcast({ ...base, terminalNotifiedAt: '2026-11-05T04:30:00.000Z' }, now), false, 'ended 90 minutes ago');
  assert.equal(shouldAutoEndBroadcast({ ...base, terminalNotifiedAt: '2026-11-05T02:00:00.000Z' }, now), true, 'ended 4 hours ago');
  assert.equal(shouldAutoEndBroadcast({ ...base, status: 'revoked' }, now), true, 'revoked while live');
  assert.equal(shouldAutoEndBroadcast({ ...base, liveEndedAt: '2026-11-05T03:00:00.000Z', status: 'revoked' }, now), false, 'already ended');
});
