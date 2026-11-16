import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RATING_DEFAULTS,
  assignRanks,
  decayStatus,
  expectedWin,
  hltvRating,
  lossProtection,
  ratingChange,
  ratingSummary,
  ratingTier,
  replayRatings,
  settleDecay
} from '../src/arenaRating.js';

const S = RATING_DEFAULTS;
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 10, 20);

// A change from the two team averages, like the spec's tables.
const change = (teamAvg, oppAvg, k, won, perf = 1) => ratingChange({ teamAvg, oppAvg, k, won, multiplier: won ? 1 : lossProtection(perf * 80, 80).multiplier });

test('single-match changes (spec section 12)', () => {
  // Even 1000 v 1000, settled and placement.
  assert.deepEqual([change(1000, 1000, 32, true), change(1000, 1000, 32, false)], [16, -16]);
  assert.deepEqual([change(1000, 1000, 48, true), change(1000, 1000, 48, false)], [24, -24]);
  // 1100 v 1000, settled: favorite, then underdog.
  assert.deepEqual([change(1100, 1000, 32, true), change(1100, 1000, 32, false)], [12, -20]);
  assert.deepEqual([change(1000, 1100, 32, true), change(1000, 1100, 32, false)], [20, -12]);
  // 1250 v 1000, settled: favorite.
  assert.deepEqual([change(1250, 1000, 32, true), change(1250, 1000, 32, false)], [6, -26]);
  // Loss protection: perf 1.30 / 1.20 / 1.00.
  assert.deepEqual([1.30, 1.20, 1.00].map((perf) => change(1000, 1000, 32, false, perf)), [-8, -12, -16]);
  assert.deepEqual([1.30, 1.20].map((perf) => change(1100, 1000, 32, false, perf)), [-10, -15]);
  assert.deepEqual([1.30, 1.20].map((perf) => change(1000, 1000, 48, false, perf)), [-12, -18]);
  assert.deepEqual([1.30, 1.20].map((perf) => change(1250, 1000, 32, false, perf)), [-13, -19]);
  // Performance never increases a win.
  assert.equal(change(1000, 1000, 32, true, 2.5), 16);
});

test('loss protection thresholds; missing ADR means none', () => {
  assert.deepEqual(lossProtection(130, 100), { multiplier: 0.5, protection: '50', perf: 1.3 });
  assert.equal(lossProtection(129.9, 100).protection, '75');
  assert.equal(lossProtection(115, 100).protection, '75');
  assert.equal(lossProtection(114.9, 100).protection, 'none');
  assert.equal(lossProtection(0, 100).multiplier, 1);
  assert.equal(lossProtection(90, 0).multiplier, 1);
  assert.equal(lossProtection(undefined, 80).protection, 'none');
});

test("one new player's first 12 games (spec section 12)", () => {
  // [won, team avg, opp avg, expected, K, perf, change, rating]
  const rows = [
    [true, 1000, 1000, 0.500, 48, 1.20, 24, 1024],
    [true, 1010, 995, 0.522, 48, 1.05, 23, 1047],
    [false, 1030, 1040, 0.486, 48, 1.30, -12, 1035],
    [true, 1020, 1060, 0.443, 48, 1.10, 27, 1062],
    [false, 1040, 1000, 0.557, 48, 0.70, -27, 1035],
    [true, 1050, 1050, 0.500, 32, 0.90, 16, 1051],
    [true, 1060, 1020, 0.557, 32, 1.15, 14, 1065],
    [false, 1070, 1100, 0.457, 32, 1.25, -11, 1054],
    [true, 1080, 1030, 0.571, 32, 1.00, 14, 1068],
    [true, 1090, 1090, 0.500, 32, 1.20, 16, 1084],
    [false, 1100, 1050, 0.571, 32, 0.85, -18, 1066],
    [true, 1110, 1150, 0.443, 32, 1.10, 18, 1084]
  ];
  let rating = S.startRating;
  rows.forEach(([won, teamAvg, oppAvg, expected, k, perf, expectedChange, expectedRating], index) => {
    assert.equal(expectedWin(teamAvg, oppAvg).toFixed(3), expected.toFixed(3), `game ${index + 1}: expected`);
    assert.equal(k, index < S.placementGames ? S.kPlacement : S.kNormal, `game ${index + 1}: K`);
    const delta = change(teamAvg, oppAvg, k, won, perf);
    assert.equal(delta, expectedChange, `game ${index + 1}: change`);
    rating += delta;
    assert.equal(rating, expectedRating, `game ${index + 1}: rating`);
    if (index === 4) assert.equal(ratingTier(rating).label, 'Ember II', 'ranked after game 5');
  });
  assert.equal(ratingTier(rating).label, 'Ember I');
});

// A player with `games` played, last game `days` ago, settled to now.
function decayed(rating, days, { games = 20 } = {}) {
  const player = { id: 'p', rating, games, lastGameAt: T0, decayDays: 0, decayed: 0 };
  const rows = settleDecay(player, T0 + days * DAY);
  return { rating: player.rating, rows, player };
}

test('decay (spec section 12)', () => {
  assert.equal(decayed(1300, 7).rating, 1300, 'no decay inside 7 days');
  assert.equal(decayed(1300, 7.99).rating, 1300);
  assert.equal(decayed(1300, 10).rating, 1285);
  assert.equal(decayed(1300, 14).rating, 1265);
  assert.equal(decayed(1300, 27).rating, 1200, 'the 100 cap');
  assert.equal(decayed(1300, 90).rating, 1200, 'and it stops there');
  assert.equal(decayed(1030, 13).rating, 1000, 'the floor');
  assert.equal(decayed(1030, 60).rating, 1000);
  assert.equal(decayed(950, 60).rating, 950, 'at or under 1000 never decays');
  assert.equal(decayed(1300, 30, { games: 3 }).rating, 1300, 'placement players are exempt');
  // One history row per day, dated the day it happened.
  const { rows } = decayed(1300, 10);
  assert.deepEqual(rows.map((row) => [row.reason, row.change, row.after, (row.at - T0) / DAY]), [['decay', -5, 1295, 8], ['decay', -5, 1290, 9], ['decay', -5, 1285, 10]]);
  // Settling again the same day takes nothing more; the next day takes one more step.
  const { player } = decayed(1300, 10);
  assert.equal(settleDecay(player, T0 + 10.5 * DAY).length, 0);
  assert.equal(settleDecay(player, T0 + 11 * DAY).length, 1);
  assert.equal(player.rating, 1280);
});

// A finished game: team A (ids a1..a5) vs team B (b1..b5).
function game(id, day, winner, { adr = {}, left = [], hasStats = true } = {}) {
  const team = (prefix) => ({
    label: `Team ${prefix}`,
    players: [1, 2, 3, 4, 5].map((index) => ({ id: `${prefix}${index}`, n: `${prefix}${index}`, k: 10, d: 10, a: 1, adr: adr[`${prefix}${index}`] ?? 80, left: left.includes(`${prefix}${index}`) }))
  });
  return { id, finishedAt: new Date(T0 + day * DAY).toISOString(), winner, hasStats, teams: [team('a'), team('b')] };
}

test('replay: placement K, changes worked out from the "before" ratings, deterministic', () => {
  const games = [game('g1', 0, 0), game('g2', 1, 0), game('g3', 2, 1)];
  const { players, history, games: results } = replayRatings(games, [], { nowMs: T0 + 3 * DAY });
  // Game 1: everyone 1000, K 48: +24 / -24.
  assert.deepEqual(results.get('g1').players.a1, { before: 1000, after: 1024, change: 24, k: 48, protection: 'none', placement: true, gameNumber: 1 });
  assert.equal(results.get('g1').players.b1.change, -24);
  assert.deepEqual(results.get('g1').teamAvg, [1000, 1000]);
  assert.deepEqual(results.get('g1').expected, [0.5, 0.5]);
  // Game 2: 1024 v 976, the favorite wins a bit less.
  assert.equal(results.get('g2').players.a1.before, 1024);
  assert.equal(results.get('g2').players.a1.change, 21);
  assert.equal(results.get('g2').players.b1.change, -21);
  assert.equal(players.get('a1').games, 3);
  assert.equal(players.get('a1').wins, 2);
  assert.equal(players.get('a1').peak, 1045);
  assert.equal(history.filter((row) => row.playerId === 'a1').length, 3);
  assert.equal(history.filter((row) => row.playerId === 'a1')[0].matchId, 'g1');
  // The same data in any order gives the same ratings.
  const again = replayRatings([games[2], games[0], games[1]], [], { nowMs: T0 + 3 * DAY });
  assert.deepEqual([...again.players.values()], [...players.values()]);
});

test('replay: loss protection, a short team, missing stats', () => {
  // b1 carried a loss (ADR 130 vs team average 100): half the loss. b2: 1.15 -> three quarters.
  const carried = replayRatings([game('g1', 0, 0, { adr: { b1: 130, b2: 115, b3: 85, b4: 85, b5: 85 } })], [], { nowMs: T0 });
  assert.equal(carried.games.get('g1').players.b1.change, -12);
  assert.equal(carried.games.get('g1').players.b1.protection, '50');
  assert.equal(carried.games.get('g1').players.b2.change, -18);
  assert.equal(carried.games.get('g1').players.b2.protection, '75');
  assert.equal(carried.games.get('g1').players.b3.change, -24);
  assert.equal(carried.games.get('g1').players.a1.change, 24, 'winners are never boosted');
  // b5 left: the four who stayed lose half, the one who left loses in full.
  const short = replayRatings([game('g1', 0, 0, { left: ['b5'] })], [], { nowMs: T0 });
  assert.equal(short.games.get('g1').players.b1.change, -12);
  assert.equal(short.games.get('g1').players.b1.protection, 'short');
  assert.equal(short.games.get('g1').players.b5.change, -24);
  // No stats from FACEIT: a normal win/loss.
  const bare = replayRatings([game('g1', 0, 0, { adr: { b1: 0, b2: 0, b3: 0, b4: 0, b5: 0 }, hasStats: false })], [], { nowMs: T0 });
  assert.equal(bare.games.get('g1').players.b1.change, -24);
});

test('replay: decay between games, staff adjustments at their time, placement exempt', () => {
  // a1 plays 6 games (ranked), then nothing for 14 days, then plays again.
  const games = [0, 1, 2, 3, 4, 5].map((day) => game(`g${day}`, day, 0));
  const idle = replayRatings(games, [], { nowMs: T0 + 5 * DAY + 14 * DAY });
  const beforeDecay = replayRatings(games, [], { nowMs: T0 + 5 * DAY }).players.get('a1').rating;
  assert.equal(idle.players.get('a1').rating, beforeDecay - 35, '7 days of decay after the 7-day grace');
  assert.equal(idle.players.get('a1').decayed, 35);
  assert.equal(idle.history.filter((row) => row.playerId === 'a1' && row.reason === 'decay').length, 7);
  // Playing ends the stretch: "rating before" is the decayed rating, and the count starts over.
  const back = replayRatings([...games, game('back', 5 + 14, 0)], [], { nowMs: T0 + 5 * DAY + 14 * DAY + 7 * DAY });
  assert.equal(back.games.get('back').players.a1.before, beforeDecay - 35);
  assert.equal(back.players.get('a1').decayed, 0, 'no new decay inside the 7 days after that game');
  // The losers are below 1000, so they never decay.
  assert.equal(idle.players.get('b1').decayed, 0);
  // A staff adjustment is applied at its own time and logged with who and why.
  const adjusted = replayRatings(games, [{ id: 'x', at: new Date(T0 + 2.5 * DAY).toISOString(), playerId: 'a1', amount: -50, reason: 'smurf', staffId: 's1', staffTag: 'Crown' }], { nowMs: T0 + 5 * DAY });
  const row = adjusted.history.find((entry) => entry.reason === 'staff_adjust');
  assert.deepEqual([row.change, row.note, row.staffTag], [-50, 'smurf', 'Crown']);
  assert.equal(adjusted.games.get('g3').players.a1.before, replayRatings(games, [], { nowMs: T0 + 5 * DAY }).games.get('g3').players.a1.before - 50);
  // A player still in placement never decays.
  const placing = replayRatings(games.slice(0, 3), [], { nowMs: T0 + 40 * DAY });
  assert.equal(placing.players.get('a1').decayed, 0);
  assert.equal(decayStatus(placing.players.get('a1'), T0 + 40 * DAY).state, 'none');
  assert.deepEqual(decayStatus(idle.players.get('a1'), T0 + 5 * DAY + 14 * DAY), { state: 'decaying', lost: 35 });
  assert.deepEqual(decayStatus(replayRatings(games, [], { nowMs: T0 + 5 * DAY + 3 * DAY }).players.get('a1'), T0 + 5 * DAY + 3 * DAY), { state: 'grace', daysUntil: 5 });
});

test('ranks and divisions (spec section 12)', () => {
  assert.equal(ratingTier(1000).label, 'Ember II');
  assert.deepEqual([849, 850, 949, 950].map((rating) => ratingTier(rating).label), ['Spark III', 'Spark II', 'Spark I', 'Ember III']);
  assert.deepEqual([1249, 1250, 1399].map((rating) => ratingTier(rating).label), ['Blaze I', 'Inferno III', 'Inferno I']);

  const player = (id, rating, extra = {}) => ({ id, rating, games: 20, wins: 10, ...extra });
  // 12 players at 1400+: only the top 10 are Rank X; the 12th is Inferno I.
  const many = Array.from({ length: 12 }, (_, index) => player(`p${index + 1}`, 1500 - index * 5));
  many[11] = player('p12', 1420);
  many[2] = player('p3', 1490);
  let ranks = assignRanks([...many, player('third', 1420)]);
  assert.equal(ranks.p12.label, 'Inferno I', '1420 but 12th highest');
  assert.equal(ranks.p1.label, 'Rank X 👑');
  assert.equal(ranks.p1.key, 'crown', 'the crown holds only Rank X 👑');
  assert.equal(ranks.p3.key, 'rankx');
  assert.equal(Object.values(ranks).filter((rank) => rank.key === 'rankx' || rank.key === 'crown').length, 10);
  // 1420 and 3rd highest: Rank X.
  ranks = assignRanks([player('a', 1460), player('b', 1440), player('c', 1420), player('d', 1300)]);
  assert.deepEqual([ranks.a.label, ranks.b.label, ranks.c.label, ranks.d.label], ['Rank X 👑', 'Rank X', 'Rank X', 'Inferno II']);
  // The highest rating overall but under 1400: Inferno I, no crown, and nobody is Rank X.
  ranks = assignRanks([player('a', 1380), player('b', 1200)]);
  assert.equal(ranks.a.label, 'Inferno I');
  // A Rank X player decays to 1395: they drop to Inferno I and the next player moves in.
  const eleven = Array.from({ length: 11 }, (_, index) => player(`p${index + 1}`, 1500 - index * 5));
  assert.equal(assignRanks(eleven).p11.label, 'Inferno I');
  eleven[4] = player('p5', 1395);
  ranks = assignRanks(eleven);
  assert.equal(ranks.p5.label, 'Inferno I');
  assert.equal(ranks.p11.key, 'rankx');
  // Three games: Unranked, "Placing 3/5".
  ranks = assignRanks([player('new', 1500, { games: 3 }), player('old', 1410)]);
  assert.deepEqual(ranks.new, { key: 'unranked', label: 'Placing 3/5', placing: true });
  assert.equal(ranks.old.key, 'crown', 'placement players take no Rank X slot');
  // Banned: rating kept, but never Rank X.
  ranks = assignRanks([player('ban', 1500), player('ok', 1410)], { banned: new Set(['ban']) });
  assert.equal(ranks.ban.label, 'Inferno I');
  assert.equal(ranks.ok.key, 'crown');
  // Ties for a slot: more wins first, then more games.
  ranks = assignRanks([player('x', 1450, { wins: 5 }), player('y', 1450, { wins: 9 }), player('z', 1450, { wins: 9, games: 30 })]);
  assert.deepEqual([ranks.z.key, ranks.y.key, ranks.x.key], ['crown', 'rankx', 'rankx']);
});

test('the sanity summary after a recalc', () => {
  const games = [0, 1, 2, 3, 4, 5].map((day) => game(`g${day}`, day, 0));
  const { players } = replayRatings(games, [], { nowMs: T0 + 6 * DAY });
  const summary = ratingSummary(players, assignRanks([...players.values()]));
  assert.equal(summary.players, 10);
  assert.equal(summary.ranked, 10);
  assert.equal(summary.max, players.get('a1').rating);
  assert.equal(summary.min, players.get('b1').rating);
  assert.equal(summary.top.length, 10);
  assert.equal(summary.top[0].rating, summary.max);
  assert.equal(Object.values(summary.perRank).reduce((sum, count) => sum + count, 0), 10);
});

test('HLTV Rating 1.0 from the match stats', () => {
  // 25 kills, 15 deaths in 26 rounds, with four double-kill rounds and two triple-kill rounds:
  // kill 1.416, survival 1.335, multi-kill (11 + 16 + 18) / 26 / 1.277 = 1.355 -> 1.37.
  assert.equal(hltvRating({ kills: 25, deaths: 15, rounds: 26, k2: 4, k3: 2 }), 1.37);
  // No multi-kills: every kill is a single.
  assert.equal(hltvRating({ kills: 20, deaths: 12, rounds: 20 }), 1.16);
  // An average game is close to 1.00.
  assert.equal(hltvRating({ kills: 17, deaths: 17, rounds: 24, k2: 3, k3: 1 }), 0.98);
  assert.equal(hltvRating({ kills: 0, deaths: 20, rounds: 20 }), 0);
  assert.equal(hltvRating({ kills: 10, deaths: 5, rounds: 0 }), 0, 'no rounds, no rating');
  // An ace round counts for much more than five single kills.
  assert.ok(hltvRating({ kills: 5, deaths: 10, rounds: 20, k5: 1 }) > hltvRating({ kills: 5, deaths: 10, rounds: 20 }));
});

test('loss protection goes by HLTV rating; ADR when a match has no rating, or when set to ADR', () => {
  // b1 has the best HLTV rating on the losing team but ordinary damage; b2 the reverse.
  const byRating = game('g1', 0, 0, { adr: { b1: 80, b2: 130, b3: 80, b4: 80, b5: 80 } });
  for (const line of byRating.teams.flat().flatMap((team) => team.players)) line.hr = 1;
  byRating.teams[1].players[0].hr = 1.6;
  byRating.teams[1].players[1].hr = 0.9;
  let result = replayRatings([byRating], [], { nowMs: T0 }).games.get('g1').players;
  assert.equal(result.b1.protection, '50', 'the best rating on the losing side is protected');
  assert.equal(result.b1.change, -12);
  assert.equal(result.b2.protection, 'none', 'damage alone no longer protects');
  assert.equal(result.b2.change, -24);
  // The same match with the setting on ADR.
  result = replayRatings([byRating], [], { nowMs: T0, settings: { ...S, protectionStat: 'adr' } }).games.get('g1').players;
  assert.equal(result.b1.protection, 'none');
  assert.equal(result.b2.protection, '50');
  // An older match saved without HLTV ratings: ADR is used.
  result = replayRatings([game('g1', 0, 0, { adr: { b1: 130, b2: 115, b3: 85, b4: 85, b5: 85 } })], [], { nowMs: T0 }).games.get('g1').players;
  assert.equal(result.b1.protection, '50');
  assert.equal(result.b2.protection, '75');
});
