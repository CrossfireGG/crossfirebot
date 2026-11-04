import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCoverageNotice, splitMatchupTeams, streamChannelName } from '../src/streamRequest.js';

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

test('active coverage notice names the stream channel without mentioning anyone', () => {
  const notice = buildCoverageNotice(request);
  assert.equal(notice.title, '🎙️ This match will be streamed!');
  assert.equal(notice.description, '**Alpha vs Bravo** will be cast live by **caster**');
  assert.doesNotMatch(JSON.stringify(notice), /<@123>/);
  assert.equal(notice.fields.find((field) => field.name === 'Watch').value, request.streamUrl);
  assert.equal(notice.fields.some((field) => /twitch/i.test(field.name)), false);
  assert.equal(notice.followUp, null);
});

test('a link that is not a channel page falls back to the Discord tag', () => {
  const notice = buildCoverageNotice({ ...request, streamUrl: 'https://www.twitch.tv/search?term=OmenEsportsCS2' });
  assert.match(notice.description, /cast live by \*\*caster#0001\*\*$/);
});

test('streamChannelName reads the channel from each platform', () => {
  assert.equal(streamChannelName('https://www.twitch.tv/spawned_in'), 'spawned_in');
  assert.equal(streamChannelName('https://twitch.tv/Spawned_In/'), 'Spawned_In');
  assert.equal(streamChannelName('https://www.youtube.com/@caster'), '@caster');
  assert.equal(streamChannelName('https://youtube.com/c/CasterName'), 'CasterName');
  assert.equal(streamChannelName('https://kick.com/caster-one'), 'caster-one');
  assert.equal(streamChannelName('https://www.twitch.tv/search?term=x'), null);
  assert.equal(streamChannelName('https://www.twitch.tv/directory/category/counter-strike'), null);
  assert.equal(streamChannelName('https://youtube.com/watch?v=abc'), null);
  assert.equal(streamChannelName('not a url'), null);
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
