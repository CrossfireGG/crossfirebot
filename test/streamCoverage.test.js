import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCoverageNotice, splitMatchupTeams } from '../src/streamRequest.js';

const request = {
  id: 'stream-abc',
  matchup: 'Alpha vs Bravo',
  requesterId: '123',
  requesterTag: 'caster#0001',
  streamUrl: 'https://twitch.tv/caster',
  streamPlatform: 'twitch',
  faceitUrl: 'https://www.faceit.com/en/cs2/room/1-abc',
  faceitScheduledAtIso: '2026-11-05T01:00:00.000Z'
};

test('active coverage notice names the caster without mentioning them', () => {
  const notice = buildCoverageNotice(request);
  assert.equal(notice.title, '🎙️ This match will be covered by a community caster');
  assert.match(notice.description, /Alpha vs Bravo/);
  assert.match(notice.description, /caster#0001/);
  assert.doesNotMatch(notice.description, /<@123>/);
  assert.equal(notice.fields.find((field) => field.name.startsWith('Watch')).value, request.streamUrl);
  assert.equal(notice.fields.find((field) => field.name === 'Watch (twitch)').value, request.streamUrl);
  assert.equal(notice.followUp, null);
});

test('active notice falls back when the match is unscheduled and has no faceit link', () => {
  const notice = buildCoverageNotice({ ...request, faceitScheduledAtIso: null, faceitUrl: null });
  assert.equal(notice.fields.find((field) => field.name === 'When').value, 'Not scheduled on FACEIT yet');
  assert.equal(notice.fields.some((field) => field.name === 'FACEIT Matchroom'), false);
});

test('cancelled notice says whether another caster remains', () => {
  const none = buildCoverageNotice(request, { cancelled: true });
  assert.equal(none.title, '🚫 Community coverage cancelled');
  assert.match(none.followUp, /No community caster is covering this match now\./);

  const some = buildCoverageNotice(request, { cancelled: true, remainingCasters: 2, reason: 'Staff revoked the approval.' });
  assert.match(some.description, /Staff revoked the approval\./);
  assert.match(some.followUp, /2 other approved caster\(s\) still have this match\./);
});

test('splitMatchupTeams handles vs and vs. with odd spacing', () => {
  assert.deepEqual(splitMatchupTeams('Alpha vs Bravo'), ['Alpha', 'Bravo']);
  assert.deepEqual(splitMatchupTeams('Alpha  VS.  Bravo Team'), ['Alpha', 'Bravo Team']);
  assert.deepEqual(splitMatchupTeams(''), []);
});
