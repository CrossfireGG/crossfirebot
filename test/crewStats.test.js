import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSchedulePost, schedulePostDateText, computeSeasonCrewStats, personSeasonHistory, formatRanking } from '../src/crewStats.js';
import { buildMainStreamSchedulePost } from '../src/streamRequest.js';

const ROOM = 'https://www.faceit.com/en/cs2/room/1-bcbc5942-70e6-4709-b350-d0877df5b8e1';
const A = '111111111111111111';
const B = '222222222222222222';
const C = '333333333333333333';
const D = '444444444444444444';

test('a hand-made Schedule channel post is read', () => {
  const content = `Thursday, November 5, 2026 / 9:30 PM / Celestial Esports VS FUELED BY HATE / ${ROOM} / Casters: <@${A}> & <@${B}> / Prod: <@${C}> / Obs: tmm / Streams: https://twitch.tv/playcrossfire (A)`;
  const post = parseSchedulePost(content);
  assert.equal(post.matchId, '1-bcbc5942-70e6-4709-b350-d0877df5b8e1');
  assert.deepEqual(post.crew, { casters: [A, B], producer: C, observer: null, admin: null, social: null });
  assert.deepEqual(post.names, { observer: ['tmm'] });
  assert.equal(post.matchupText, 'Celestial Esports VS FUELED BY HATE');
  assert.equal(post.cancelled, false);
  assert.equal(schedulePostDateText(content), 'Thursday, November 5, 2026 9:30 PM');
});

test("the bot's own crew post is read, including its timestamp", () => {
  const content = buildMainStreamSchedulePost({
    teamA: 'Celestial Esports', teamB: 'FUELED BY HATE', faceitUrl: ROOM, scheduleIso: '2026-11-06T02:30:00Z',
    crew: { casters: [A], producer: C, observer: D, admin: null, social: null }, streamUrl: 'https://twitch.tv/playcrossfire'
  });
  const post = parseSchedulePost(content);
  assert.deepEqual(post.crew, { casters: [A], producer: C, observer: D, admin: null, social: null });
  assert.equal(post.timestampMs, Date.parse('2026-11-06T02:30:00Z'));
  assert.equal(parseSchedulePost(`❌ **CANCELLED: no longer on the main stream**\n\n${content}`).cancelled, true);
  assert.equal(parseSchedulePost('Just a chat message'), null);
});

test('season counts per role and for community casts', () => {
  const now = Date.UTC(2026, 10, 10);
  const day = (d) => Date.UTC(2026, 10, d, 2);
  const mainStream = [
    { matchId: 'm1', startMs: day(3), crew: { casters: [A, B], producer: C }, matchup: 'X vs Y' },
    { matchId: 'm2', startMs: day(5), crew: { casters: [A], producer: C, observer: D }, matchup: 'Z vs W' },
    { matchId: 'm3', startMs: day(12), crew: { casters: [B], producer: C }, matchup: 'Booked vs Later' },
    { matchId: 'old', startMs: Date.UTC(2026, 7, 1), crew: { casters: [A] } }
  ];
  const community = [
    { requesterId: D, startMs: day(4), matchup: 'X vs Y' },
    { requesterId: D, startMs: day(6), matchup: 'Q vs R' },
    { requesterId: A, startMs: day(11), matchup: 'S vs T' }
  ];
  const inSeason = (ms) => ms >= Date.UTC(2026, 10, 2);
  const stats = computeSeasonCrewStats({ mainStream, community, inSeason, now });
  assert.equal(stats.mainStreamMatches, 3);
  assert.deepEqual(stats.roles.caster, [{ id: A, done: 2, booked: 0 }, { id: B, done: 1, booked: 1 }]);
  assert.deepEqual(stats.roles.producer, [{ id: C, done: 2, booked: 1 }]);
  assert.deepEqual(stats.roles.observer, [{ id: D, done: 1, booked: 0 }]);
  assert.deepEqual(stats.community, [{ id: D, done: 2, booked: 0 }, { id: A, done: 0, booked: 1 }]);
  assert.equal(formatRanking(stats.roles.caster), `<@${A}> 2 · <@${B}> 1 (+1)`);
  assert.equal(formatRanking([]), 'Nobody yet.');
  const history = personSeasonHistory(A, { mainStream, community, inSeason });
  assert.deepEqual(history.map((entry) => [entry.matchup, entry.roles.join('/')]), [['S vs T', 'Community cast'], ['Z vs W', 'Caster'], ['X vs Y', 'Caster']]);
});
