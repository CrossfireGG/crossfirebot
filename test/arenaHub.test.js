import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// The stores pick their files when first loaded, so point them at a temp folder before loading
// anything that uses them (never the real bot-data.json, arena-games.json or arena-ratings.json).
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crossfire-arenahub-'));
process.env.BOT_DATA_PATH = path.join(tempDir, 'bot-data.json');
process.env.ARENA_GAMES_PATH = path.join(tempDir, 'arena-games.json');
process.env.ARENA_RATINGS_PATH = path.join(tempDir, 'arena-ratings.json');
const store = await import('../src/store.js');
const {
  cancelledGame,
  compactGame,
  createGameStore,
  createRatingStore,
  currentSeason,
  historyPageText,
  hubSeasons,
  latestSeason,
  leaderboardText,
  liveBoardText,
  matchCard,
  playerIdByNickname,
  playerRecord,
  playerSeasons,
  queueText,
  recapText,
  seasonAt,
  statsCard,
  topFragger,
  weeklyRecap
} = await import('../src/arenaGames.js');
const { assignRanks, replayRatings } = await import('../src/arenaRating.js');
const { createArenaHub, zoneMidnightMs } = await import('../src/arenaHub.js');

const DAY = 24 * 60 * 60 * 1000;
const S8_START = Date.UTC(2026, 9, 17);
const S8_END = Date.UTC(2026, 10, 16);
const LEADERBOARDS = [
  { leaderboard_type: 'hub_general', leaderboard_name: 'All time Leaderboard', leaderboard_id: 'all', start_date: 1, end_date: 9e9, status: 'ONGOING' },
  { leaderboard_type: 'hub_season', leaderboard_name: 'Season 8', leaderboard_id: 's8', season: 8, start_date: S8_START / 1000, end_date: S8_END / 1000, status: 'FINISHED' },
  { leaderboard_type: 'hub_season', leaderboard_name: 'Season 7 ', leaderboard_id: 's7', season: 7, start_date: Date.UTC(2026, 8, 12) / 1000, end_date: Date.UTC(2026, 8, 26) / 1000, status: 'FINISHED' }
];
const SEASONS = hubSeasons(LEADERBOARDS);

const roster = (prefix) => Array.from({ length: 5 }, (_, index) => ({ player_id: `${prefix}${index + 1}`, nickname: `${prefix.toUpperCase()}-nick${index + 1}`, game_player_id: '' }));

// A FACEIT hub match. winner: 'faction1' | 'faction2' | null (not finished).
function hubMatch({ id = 'm1', status = 'FINISHED', winner = 'faction2', score = [16, 19], finishedMs = Date.UTC(2026, 10, 14, 4), map = 'de_mirage' } = {}) {
  return {
    match_id: id,
    competition_id: 'hub',
    status,
    faceit_url: `https://www.faceit.com/{lang}/cs2/room/${id}`,
    started_at: Math.floor((finishedMs - 3600000) / 1000),
    finished_at: winner ? Math.floor(finishedMs / 1000) : undefined,
    voting: { map: { pick: [map] }, location: { pick: ['Chicago'] } },
    teams: { faction1: { name: 'team_Zoro', leader: 'a1', roster: roster('a') }, faction2: { name: 'team_Beta', leader: 'b1', roster: roster('b') } },
    results: winner ? { winner, score: { faction1: score[0], faction2: score[1] } } : undefined
  };
}

// Its /stats payload. kills / adr: per player id (default 10 kills, ADR 80). skip: ids with no line.
function hubStats(match, { kills = {}, adr = {}, skip = [] } = {}) {
  const line = (player) => ({
    player_id: player.player_id,
    nickname: player.nickname,
    player_stats: { Kills: String(kills[player.player_id] ?? 10), Deaths: '12', Assists: '3', ADR: String(adr[player.player_id] ?? 80), 'K/D Ratio': '0.83', 'Headshots %': '40', MVPs: '2' }
  });
  const team = (faction) => ({ players: match.teams[faction].roster.filter((player) => !skip.includes(player.player_id)).map(line) });
  return { rounds: [{ round_stats: { Map: match.voting.map.pick[0] }, teams: [team('faction1'), team('faction2')] }] };
}

test('seasons come from the hub leaderboards; a match belongs to the season it finished in', () => {
  assert.deepEqual(SEASONS.map((season) => `${season.season}:${season.name}`), ['7:Season 7', '8:Season 8']);
  assert.equal(seasonAt(Date.UTC(2026, 10, 14), SEASONS), 8);
  assert.equal(seasonAt(Date.UTC(2026, 9, 1), SEASONS), null, 'between seasons');
  assert.equal(currentSeason(SEASONS, Date.UTC(2026, 10, 1)).season, 8);
  assert.equal(currentSeason(SEASONS, S8_END + DAY), null, 'no season running after Season 8 ended');
  assert.equal(latestSeason(SEASONS, S8_END + DAY).season, 8, 'the newest one that has started');
});

test('the match record: finished and cancelled matches, keyed by FACEIT player id', () => {
  const match = hubMatch();
  const game = compactGame(match, hubStats(match, { kills: { b3: 31 }, skip: ['a5'] }), { number: 12, voice: { a1: { joinedAt: 'x', leftAt: 'y', seconds: 1800 } }, seasons: SEASONS });
  assert.equal(game.id, 'm1');
  assert.equal(game.hubId, 'hub');
  assert.equal(game.status, 'finished');
  assert.equal(game.number, 12);
  assert.equal(game.season, 8);
  assert.equal(game.map, 'Mirage');
  assert.equal(game.server, 'Chicago');
  assert.deepEqual(game.score, [16, 19]);
  assert.equal(game.winner, 1);
  assert.deepEqual(game.teams.map((team) => `${team.label}:${team.captain}`), ['Team Zoro:a1', 'Team Beta:b1']);
  assert.deepEqual(game.teams[0].players[0], { id: 'a1', n: 'A-nick1', k: 10, d: 12, a: 3, adr: 80, kd: 0.83, hs: 40, mvp: 2, hr: 0.78 });
  assert.equal(game.teams[0].players[4].left, true, 'on the roster with no stats line: they left');
  assert.equal(game.teams[1].players[0].left, undefined);
  assert.deepEqual(game.voice, { a1: { joinedAt: 'x', leftAt: 'y', seconds: 1800 } });
  assert.equal(game.url, 'https://www.faceit.com/en/cs2/room/m1');
  assert.equal(topFragger(game).n, 'B-nick3');
  // No result yet, or no stats yet.
  assert.equal(compactGame(hubMatch({ winner: null }), null), null);
  const bare = compactGame(match, null, { seasons: SEASONS });
  assert.equal(bare.hasStats, false);
  assert.equal(bare.teams[0].players[4].left, undefined, 'nobody "left" when there are no stats at all');
  // A cancelled match is kept, with no result.
  const cancelled = cancelledGame(hubMatch({ id: 'c1', status: 'CANCELLED', winner: null }), { number: 13, seasons: SEASONS });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.winner, null);
  assert.equal(cancelled.teams[0].players.length, 5);
  assert.equal(playerRecord([cancelled], 'a1').played, 0, 'cancelled matches count for nothing');
});

// Five games for a1 (team A): W, W, L in season 7; W, W in season 8.
function fiveGames() {
  const make = (id, winner, day, extra = {}) => {
    const match = hubMatch({ id, winner, score: winner === 'faction1' ? [13, 7] : [7, 13], finishedMs: day, ...extra });
    return compactGame(match, hubStats(match, { kills: { a1: 20 } }), { seasons: SEASONS });
  };
  const s7 = Date.UTC(2026, 8, 13);
  return [
    make('g1', 'faction1', s7), make('g2', 'faction1', s7 + DAY), make('g3', 'faction2', s7 + 2 * DAY),
    make('g4', 'faction1', Date.UTC(2026, 10, 9, 20), { map: 'de_dust2' }), make('g5', 'faction1', Date.UTC(2026, 10, 10, 20))
  ];
}

test('a player record: all time, one season, streaks, the last games and their rating changes', () => {
  const games = fiveGames();
  const ratings = replayRatings(games, [], { nowMs: Date.UTC(2026, 10, 11) }).games;
  const all = playerRecord(games, 'a1', { ratings });
  assert.equal(`${all.played} ${all.won}-${all.lost}`, '5 4-1');
  assert.equal(all.winRate, 0.8);
  assert.equal(all.kills, 100);
  assert.equal(all.bestStreak, 2);
  assert.equal(all.streak, 2, 'two wins in a row now');
  assert.equal(all.nickname, 'A-nick1');
  assert.deepEqual(all.last.map((game) => `${game.won ? 'W' : 'L'} ${game.score} ${game.map} ${game.change}`), ['W 13-7 Mirage 19', 'W 13-7 Dust2 22', 'L 7-13 Mirage -15', 'W 13-7 Mirage 21', 'W 13-7 Mirage 24'], 'newest first');
  const s7 = playerRecord(games, 'a1', { season: 7 });
  assert.equal(`${s7.won}-${s7.lost}`, '2-1');
  assert.deepEqual(playerSeasons(games, 'a1'), [8, 7]);
  assert.equal(playerRecord(games, 'nobody').played, 0);
  assert.equal(playerIdByNickname(games, 'a-NICK1'), 'a1');
  assert.equal(playerIdByNickname(games, 'ghost'), null);
});

test('the weekly recap: games, wins, streak, top fragger, rating gain and new ranks, one season', () => {
  const games = fiveGames();
  const ratings = replayRatings(games, [], { nowMs: Date.UTC(2026, 10, 16) }).games;
  const fromMs = zoneMidnightMs('2026-11-09', 'America/Chicago');
  const toMs = zoneMidnightMs('2026-11-16', 'America/Chicago');
  assert.equal(new Date(fromMs).toISOString(), '2026-11-09T06:00:00.000Z', 'Monday midnight in Chicago');
  const recap = weeklyRecap(games, { fromMs, toMs, season: 8, ratings });
  assert.equal(recap.games, 2);
  assert.equal(recap.players, 10);
  assert.deepEqual(recap.mostWins, { names: ['A-nick1', 'A-nick2', 'A-nick3', 'A-nick4', 'A-nick5'], value: 2 });
  assert.deepEqual(recap.topFragger, { names: ['A-nick1'], value: 40 });
  assert.equal(recap.biggestGain.value, 41, 'two wins that week: +22 and +19');
  const text = recapText(recap, { fromMs, toMs, seasonName: 'Season 8', rankUps: [{ nickname: 'A-nick1', rank: 'Blaze' }] });
  assert.match(text, /^## 📅 Arena weekly recap · Season 8\nMon, Nov 9 to Sun, Nov 15: \*\*2\*\* games, \*\*10\*\* players/);
  assert.match(text, /\*\*Top fragger:\*\* A-nick1 \(40 kills\)/);
  assert.match(text, /\*\*Biggest rating gain:\*\* A-nick1, A-nick2, A-nick3 \+2 more \(\+41\)/);
  assert.match(text, /\*\*New ranks:\*\* A-nick1 \(Blaze\)$/);
  assert.equal(weeklyRecap(games, { fromMs, toMs, season: 7 }).games, 0, 'current season only');
  assert.equal(recapText(weeklyRecap([], { fromMs, toMs }), { fromMs, toMs }), null, 'no post for a week without games');
});

test('match cards: draft finished, finished with rating changes, cancelled', () => {
  const ranks = {
    a1: { label: 'Blaze II', placing: false }, a2: { label: 'Placing 3/5', placing: true },
    b1: { label: 'Inferno III', placing: false }, b2: { label: 'Rank X 👑', placing: false }
  };
  const ratings = { a1: 1185, a2: 1040, b1: 1291, b2: 1452 };
  const teams = [
    { label: 'Team Zoro', captain: 'a1', players: [{ playerId: 'a1', nickname: 'A_nick1' }, { playerId: 'a2', nickname: 'Newbie' }] },
    { label: 'Team Beta', captain: 'b1', players: [{ playerId: 'b1', nickname: 'Carry' }, { playerId: 'b2', nickname: 'King' }] }
  ];
  const live = matchCard({ stage: 'live', number: 12, teams, map: 'Mirage', server: 'Chicago', url: 'https://x', status: 'ONGOING', teamAvg: [1113, 1372], expected: [0.18, 0.82], ranks, ratings, links: { a1: { discordId: '111' } } });
  assert.equal(live.title, '🔴 Arena 12: live');
  assert.match(live.description, /\*\*Team Zoro vs Team Beta\*\*\n\*\*Map:\*\* Mirage · \*\*Server:\*\* Chicago · \[FACEIT match room\]\(https:\/\/x\)\nFACEIT: ongoing/);
  assert.equal(live.fields[0].name, '🔵 Team Zoro · avg 1113 · 18% to win');
  assert.equal(live.fields[0].value, 'A\\_nick1 (C) <@111>  Blaze II · 1185\nNewbie  Placing 3/5');
  assert.equal(live.fields[1].value, 'Carry (C)  Inferno III · 1291\nKing  Rank X 👑 · 1452');

  const game = { teams: [{ label: 'Team Zoro', captain: 'a1', players: [{ id: 'a1', n: 'A_nick1', k: 20, d: 10, a: 2 }, { id: 'a2', n: 'Newbie', k: 5, d: 12, a: 1 }] }, { label: 'Team Beta', captain: 'b1', players: [{ id: 'b1', n: 'Carry', k: 30, d: 9, a: 4 }, { id: 'b2', n: 'King', k: 8, d: 14, a: 2 }] }], score: [13, 9], winner: 0, map: 'Mirage', server: 'Chicago', url: 'https://x' };
  const result = { players: {
    a1: { before: 1185, after: 1201, change: 16, protection: 'none', placement: false, gameNumber: 30 },
    a2: { before: 1040, after: 1071, change: 31, protection: 'none', placement: true, gameNumber: 4 },
    b1: { before: 1299, after: 1291, change: -8, protection: '50', placement: false, gameNumber: 40 },
    b2: { before: 1470, after: 1452, change: -18, protection: 'short', placement: false, gameNumber: 60 }
  } };
  const done = matchCard({ stage: 'finished', number: 12, teams: game.teams, game, result, ranks, ratings });
  assert.equal(done.title, '🏁 Arena 12: Team Zoro win 13-9');
  assert.match(done.description, /\*\*Top fragger:\*\* Carry · 30\/9\/4/);
  assert.equal(done.fields[0].name, '🔵 Team Zoro · 13 🏆');
  assert.equal(done.fields[0].value, 'A\\_nick1 (C)  Blaze II  +16 → 1201\nNewbie  Placing 4/5');
  assert.equal(done.fields[1].value, 'Carry (C)  Inferno III  −8 → 1291 (loss protected, carried)\nKing  Rank X 👑  −18 → 1452 (loss protected, 4v5)');
  // The stats are not in yet: the result shows, the rating changes wait.
  const waiting = matchCard({ stage: 'finished', number: 12, teams: game.teams, game, pending: true, ranks, ratings });
  assert.match(waiting.description, /Rating changes show here once FACEIT has the match stats/);
  assert.equal(waiting.fields[0].value, 'A\\_nick1 (C)  Blaze II · 1185\nNewbie  Placing 3/5');
  const cancelled = matchCard({ stage: 'cancelled', number: 12, teams });
  assert.equal(cancelled.title, '⚪ Arena 12: cancelled');
  assert.match(cancelled.description, /Match cancelled, no rating change\./);
});

test('the pinned messages: live board, queue, season leaderboard', () => {
  const board = liveBoardText({ games: [
    { number: null, stage: 'drafting', teams: [{ label: 'Team A' }, { label: 'Team B' }], url: 'https://r' },
    { number: 12, stage: 'live', teams: [{ label: 'Team Zoro' }, { label: 'Team Beta' }], map: 'Mirage', cardUrl: 'https://discord.com/channels/g/c/m' }
  ], updatedAt: new Date(0) });
  assert.match(board, /^## 🎮 Arena: live games\n\*\*New game\*\* · drafting · Team A vs Team B · \[match room\]\(<https:\/\/r>\)\n\*\*Arena 12\*\* · live · Team Zoro vs Team Beta · Mirage · \[match card\]\(https:\/\/discord\.com\/channels\/g\/c\/m\)/);
  assert.match(liveBoardText({}), /^## 🎮 Arena: live games\nNo Arena games live right now\./);

  assert.match(queueText({ queue: ['111', '222'], queueChannelId: 'q', updatedAt: new Date(0) }), /^## ⏳ Arena queue\n\*\*In <#q> \(2\):\*\* <@111> <@222>\n-# FACEIT does not share who is in its queue/);
  assert.match(queueText({ queueChannelId: 'q' }), /Nobody is in <#q> right now\./);

  const items = [
    { position: 1, player: { user_id: 'king', nickname: 'King' }, won: 32, lost: 14 },
    { position: 2, player: { user_id: 'new', nickname: 'Newbie' }, won: 3, lost: 0 },
    { position: 3, player: { user_id: 'ban', nickname: 'Cheater' }, won: 30, lost: 2 },
    { position: 4, player: { user_id: 'inf', nickname: 'Infer_no' }, won: 28, lost: 15 },
    { position: 5, player: { user_id: 'ghost', nickname: 'NoRating' }, won: 1, lost: 1 }
  ];
  const ranks = { king: { label: 'Rank X 👑', placing: false }, new: { label: 'Placing 3/5', placing: true }, ban: { label: 'Inferno I', placing: false }, inf: { label: 'Inferno II', placing: false } };
  const text = leaderboardText({ name: 'Season 8', items, ranks, ratings: { king: 1452, new: 1060, ban: 1500, inf: 1318 }, banned: new Set(['ban']), url: 'https://hub', updatedAt: new Date(0) });
  assert.match(text, /^## 🏆 Arena season leaderboard · Season 8\n\*\*#1\*\*  King  Rank X 👑 · 1452  \(32–14\)\n\*\*#2\*\*  Infer\\_no  Inferno II · 1318  \(28–15\)\n\n\*\*Full standings:\*\* <https:\/\/hub>/);
  assert.doesNotMatch(text, /Newbie|Cheater|NoRating/, 'placement, banned and unrated players are hidden');
  assert.match(text, /Updated <t:0:R>$/);
  assert.match(leaderboardText({ name: 'Season 8', items: [], running: false }), /Season 8 \(final\)\nNobody is ranked this season yet\./);
  const many = Array.from({ length: 60 }, (_, index) => ({ player: { user_id: `p${index}`, nickname: 'x'.repeat(50) }, won: 1, lost: 0 }));
  const long = leaderboardText({ name: 'S', items: many, ranks: Object.fromEntries(many.map((row) => [row.player.user_id, { label: 'Ember II', placing: false }])), ratings: {}, limit: 25 });
  assert.ok(long.length <= 2000);
  assert.ok((long.match(/\*\*#/g) || []).length <= 25, 'top 25 at most');
});

test('/arena stats and the rating history page', () => {
  const games = fiveGames();
  const replay = replayRatings(games, [], { nowMs: Date.UTC(2026, 10, 11) });
  const ranks = assignRanks([...replay.players.values()]);
  const card = statsCard({
    nickname: 'A-nick1', discordId: '111', faceitUrl: 'https://f', rating: replay.players.get('a1'), rank: ranks.a1,
    allTime: playerRecord(games, 'a1', { ratings: replay.games }), season: playerRecord(games, 'a1', { season: 8, ratings: replay.games }),
    seasonName: 'Season 8', position: 3, decay: { state: 'grace', daysUntil: 6 }, loading: true
  });
  assert.equal(card.title, '🎮 Arena stats: A-nick1');
  assert.match(card.description, /^\[FACEIT profile\]\(https:\/\/f\) · <@111>\n_Older games are still being loaded/);
  assert.equal(card.fields[0].name, 'CF rating');
  assert.match(card.fields[0].value, /^\*\*1071\*\* · Ember I\nPeak 1071 · last 5 games: \+71\nDecay starts in 6 days without a game\.$/);
  assert.match(card.fields[1].value, /^\*\*5\*\* games · \*\*4W–1L\*\* · 80% wins\nK\/D 1\.67 · ADR 80 · Rating 1\.16\nBest win streak: 2\nCurrent streak: 2 wins$/);
  assert.equal(card.fields[2].name, 'Season 8');
  assert.match(card.fields[2].value, /\*\*2W–0L\*\* · 100% wins[\s\S]*Season leaderboard: #3$/);
  assert.match(card.fields[3].value, /^🟢 W · Mirage · 13-7 · 20-12 · 1\.16 rating · \+19\n/);
  // The loss was protected: a1 played well above their own team (HLTV rating).
  assert.match(card.fields[3].value, /🔴 L · Mirage · 7-13 · 20-12 · 1\.16 rating · −15 🛡️/);
  // Still placing, not linked, decaying.
  const placing = statsCard({ nickname: 'New', rating: { rating: 1048, peak: 1048 }, rank: { label: 'Placing 2/5', placing: true }, allTime: playerRecord(games.slice(0, 2), 'a1'), decay: { state: 'none' } });
  assert.match(placing.description, /Discord not linked/);
  assert.match(placing.fields[0].value, /^\*\*Placing 2\/5\*\* \(unranked until placement is done\)/);
  assert.match(statsCard({ nickname: 'Idle', rating: { rating: 1265, peak: 1300 }, rank: { label: 'Inferno III' }, allTime: playerRecord(games, 'a1'), decay: { state: 'decaying', lost: 35 } }).fields[0].value, /Decaying: −35 so far/);

  const rows = [
    { playerId: 'a1', at: Date.UTC(2026, 10, 1), reason: 'match', change: 24, after: 1024, matchId: 'g1' },
    { playerId: 'a1', at: Date.UTC(2026, 10, 2), reason: 'staff_adjust', change: -50, after: 974, staffTag: 'Crown', note: 'smurf' },
    { playerId: 'a1', at: Date.UTC(2026, 10, 12), reason: 'decay', change: -5, after: 969 }
  ];
  const page = historyPageText({ nickname: 'A-nick1', rows, page: 0, perPage: 2, gameUrls: { g1: 'https://room' } });
  assert.equal(page.pages, 2);
  assert.match(page.content, /^## Rating history: A-nick1\n<t:\d+:d> · \*\*−5\*\* → 969 · decay\n<t:\d+:d> · \*\*−50\*\* → 974 · staff adjust by Crown: smurf\n-# Page 1 of 2 · 3 changes, newest first$/);
  assert.match(historyPageText({ nickname: 'A-nick1', rows, page: 1, perPage: 2, gameUrls: { g1: 'https://room' } }).content, /\*\*\+24\*\* → 1024 · \[match\]\(<https:\/\/room>\)/);
});

test('the files: matches and rating inputs are saved and read back', async () => {
  const games = createGameStore(path.join(tempDir, 'games-test.json'));
  const match = hubMatch({ id: 'x1' });
  await games.upsert(compactGame(match, null, { number: 7, voice: { a1: { seconds: 60 } }, seasons: SEASONS }));
  await games.upsert(compactGame(match, hubStats(match), { seasons: SEASONS })); // the stats arrive later
  const again = createGameStore(path.join(tempDir, 'games-test.json'));
  const saved = await again.get('x1');
  assert.equal(saved.number, 7, 'keeps its number');
  assert.deepEqual(saved.voice, { a1: { seconds: 60 } }, 'and its voice activity');
  assert.equal(saved.hasStats, true);
  assert.equal(await again.count(), 1);
  const ratings = createRatingStore(path.join(tempDir, 'ratings-test.json'));
  await ratings.update((data) => { data.adjustments.push({ id: 'a', playerId: 'a1', amount: 5 }); data.banned.b1 = true; });
  const back = await createRatingStore(path.join(tempDir, 'ratings-test.json')).get();
  assert.equal(back.adjustments.length, 1);
  assert.deepEqual(back.banned, { b1: true });
});

// ---------- the bot side, with a pretend Discord and FACEIT ----------

function fakeWorld() {
  const sent = [];
  const roleChanges = [];
  const pinned = [];
  const members = new Map();
  const roles = [{ id: 'r-blaze', name: 'Blaze' }];
  const member = (id) => {
    if (!members.has(id)) {
      const held = new Set();
      members.set(id, {
        id,
        user: { bot: false },
        held,
        roles: {
          cache: { has: (roleId) => held.has(roleId) },
          add: async (roleId) => { held.add(roleId); roleChanges.push(`+${id}:${roles.find((role) => role.id === roleId)?.name}`); },
          remove: async (roleIds) => { for (const roleId of [].concat(roleIds)) { if (held.delete(roleId)) roleChanges.push(`-${id}:${roles.find((role) => role.id === roleId)?.name}`); } }
        }
      });
    }
    return members.get(id);
  };
  const guild = {
    id: 'g1',
    members: { fetch: async (id) => member(id) },
    roles: {
      cache: { has: (id) => roles.some((role) => role.id === id) },
      fetch: async () => new Map(roles.map((role) => [role.id, role])),
      create: async ({ name }) => { const role = { id: `r-${roles.length + 1}`, name }; roles.push(role); return role; }
    }
  };
  const channel = (id) => ({
    id,
    guild,
    isTextBased: () => true,
    send: async (payload) => {
      const message = { id: `${id}-m${sent.length + 1}`, channelId: id, payload, edits: 0, author: { id: 'bot' }, get content() { return message.payload.content || ''; } };
      message.edit = async (next) => { message.payload = next; message.edits += 1; };
      message.pin = async () => { pinned.push(message.id); };
      sent.push(message);
      return message;
    },
    messages: {
      fetch: async (messageId) => sent.find((message) => message.id === messageId) || Promise.reject(Object.assign(new Error('Unknown Message'), { code: 10008 })),
      fetchPinned: async () => new Map(sent.filter((message) => message.channelId === id && pinned.includes(message.id)).map((message) => [message.id, message]))
    }
  });
  const queueMembers = new Map();
  const channels = { games: channel('games'), data: channel('data'), queue: { id: 'queue', members: queueMembers } };
  const client = { user: { id: 'bot' }, channels: { fetch: async (id) => channels[id] || null } };
  const text = (message) => message.payload.content || [message.payload.embeds[0].data.title, message.payload.embeds[0].data.description, ...(message.payload.embeds[0].data.fields || []).map((field) => `${field.name}\n${field.value}`)].join('\n');
  return { client, guild, roles, sent, pinned, roleChanges, queueMembers, member, text, inChannel: (id) => sent.filter((message) => message.channelId === id) };
}

function interactionFor(replies, options = {}) {
  return {
    user: { id: options.as || 'd-a1', username: 'Crown' },
    member: { staff: options.staff ?? false },
    customId: options.customId,
    options: {
      getBoolean: (name) => options[name] ?? null,
      getString: (name) => options[name] ?? null,
      getInteger: (name) => options[name] ?? null,
      getSubcommand: () => options.sub
    },
    reply: async (payload) => replies.push(payload),
    deferReply: async (payload) => replies.push(payload),
    editReply: async (payload) => replies.push(payload),
    update: async (payload) => replies.push(payload)
  };
}

test('arena hub: match from draft to result with ratings, boards, roles, rank-ups, decay, recap, stats and staff tools', async () => {
  const world = fakeWorld();
  const clock = { ms: Date.UTC(2026, 10, 11, 1) }; // Season 8 running
  // History on the hub: team A (a1..a5) has won six games in a row, so they are ranked.
  const past = Array.from({ length: 6 }, (_, index) => hubMatch({ id: `old${index + 1}`, winner: 'faction1', score: [13, 5], finishedMs: Date.UTC(2026, 10, 1 + index, 20) }));
  past.push(hubMatch({ id: 'oldc', status: 'CANCELLED', winner: null }));
  let match = { ...hubMatch({ id: 'live1', status: 'VOTING', winner: null }), voting: {} };
  let statsReady = false;
  const seasonRows = (rows) => rows.map(([id, nickname, won, lost], index) => ({ position: index + 1, player: { user_id: id, nickname }, won, lost }));
  let leaderboard = seasonRows([['a1', 'A-nick1', 6, 0], ['b1', 'B-nick1', 0, 6]]);
  const faceit = {
    request: async (requestPath) => {
      if (requestPath.startsWith('/leaderboards/hubs/hub/seasons/8')) return { items: requestPath.includes('offset=0') ? leaderboard : [] };
      if (requestPath.startsWith('/leaderboards/hubs/hub?')) return { items: LEADERBOARDS };
      if (requestPath === '/hubs/hub') return { faceit_url: 'https://www.faceit.com/{lang}/hub/hub/Arena' };
      if (requestPath.startsWith('/hubs/hub/matches?type=past&offset=0')) return { items: past };
      if (requestPath.startsWith('/hubs/hub/matches?type=past')) return { items: [] };
      throw new Error(`unexpected ${requestPath}`);
    },
    getMatchRaw: async () => match,
    getMatchStats: async (id) => {
      if (id === 'live1' && !statsReady) throw new Error('FACEIT 404: no stats yet');
      // In the live game b1 carries the losing side.
      return hubStats(id === 'live1' ? match : past.find((entry) => entry.match_id === id), id === 'live1' ? { adr: { b1: 130, b2: 70, b3: 70, b4: 70, b5: 60 }, kills: { b1: 33 } } : {});
    },
    getPlayerByNickname: async () => null
  };
  const config = {
    arenaEnabled: true,
    arenaHubId: 'hub',
    arenaGamesChannelId: 'games',
    arenaDataChannelId: 'data',
    arenaQueueChannelId: 'queue',
    arenaTeamSize: 5,
    arenaTimeZone: 'America/Chicago',
    arenaRecapTime: '12:00',
    arenaDecayTime: '05:00',
    arenaLeaderboardSize: 25,
    arenaBannedFaceitIds: []
  };
  await store.linkArenaPlayer({ playerId: 'a1', nickname: 'A-nick1', discordId: 'd-a1', source: 'self' });
  await store.linkArenaPlayer({ playerId: 'b1', nickname: 'B-nick1', discordId: 'd-b1', source: 'self' });
  const games = createGameStore(path.join(tempDir, 'hub-games.json'));
  const ratingStore = createRatingStore(path.join(tempDir, 'hub-ratings.json'));
  const hub = createArenaHub({ client: world.client, faceit, config, games, ratingStore, isStaff: (member) => Boolean(member?.staff), now: () => clock.ms });

  // First pass: the older matches are loaded from the hub and the ratings are built from them.
  await hub.tick();
  assert.equal(await games.count(), 7, 'six finished and one cancelled');
  assert.equal((await games.get('oldc')).status, 'cancelled');
  assert.equal((await store.getArenaHubState()).backfill.done, true);
  const a1Before = hub.ratings().players.get('a1').rating;
  assert.equal(hub.ratings().players.get('a1').games, 6);
  assert.match(hub.ratings().ranks.a1.label, /^Blaze /);
  assert.match(hub.ratings().ranks.b1.label, /^Spark /);
  assert.equal(world.inChannel('data').filter((message) => /just reached/.test(message.content)).length, 0, 'history is never announced');

  // The pinned board, queue and leaderboard go up once, and the rank roles follow.
  await hub.tick();
  const board = world.inChannel('games').find((message) => message.content.startsWith('## 🎮 Arena: live games'));
  const queue = world.inChannel('games').find((message) => message.content.startsWith('## ⏳ Arena queue'));
  const lb = world.inChannel('data').find((message) => message.content.startsWith('## 🏆 Arena season leaderboard'));
  assert.match(board.content, /No Arena games live right now\./);
  assert.match(queue.content, /Nobody is in <#queue> right now\./);
  assert.match(lb.content, new RegExp(`^## 🏆 Arena season leaderboard · Season 8\\n\\*\\*#1\\*\\*  A-nick1  Blaze [IV]+ · ${a1Before}  \\(6–0\\)\\n\\*\\*#2\\*\\*  B-nick1  Spark [IV]+ · \\d+  \\(0–6\\)`));
  assert.ok([board.id, queue.id, lb.id].every((id) => world.pinned.includes(id)));
  assert.deepEqual(world.roles.map((role) => role.name).sort(), ['Blaze', 'Ember', 'Inferno', 'Rank X', 'Rank X 👑', 'Spark'].sort(), 'the existing Blaze role is reused, the rest are made');
  assert.deepEqual(world.roleChanges.sort(), ['+d-a1:Blaze', '+d-b1:Spark']);

  // FACEIT lists a match still in the captain draft: it is on the board as drafting.
  hub.hooks.onPoll([{ ...hubMatch({ id: 'draft1', status: 'CAPTAIN_PICK', winner: null }), teams: { faction1: { name: 'team_Zoro', roster: roster('a').slice(0, 2) }, faction2: { name: 'team_Beta', roster: [] } } }]);
  await hub.refreshBoard();
  assert.match(board.content, /\*\*New game\*\* · drafting · Team Zoro vs Team Beta/);
  hub.hooks.onPoll([]);

  // The draft finishes: the card goes up with ranks, ratings, team averages and win chance.
  const record = { id: 'live1', number: 12, faceitUrl: 'https://www.faceit.com/en/cs2/room/live1', channels: { faction1: 'vc1', faction2: 'vc2' }, teams: [{ label: 'Team Zoro', players: [] }, { label: 'Team Beta', players: [] }], voice: { 'd-a1': { first: '2026-11-11T00:05:00.000Z', last: '2026-11-11T00:45:00.000Z', s: 2400 } } };
  await store.saveArenaMatch('live1', record);
  await hub.hooks.onSync(record, match);
  const card = world.inChannel('games').at(-1);
  assert.match(world.text(card), /^🔴 Arena 12: live\n\*\*Team Zoro vs Team Beta\*\*/);
  assert.match(world.text(card), new RegExp(`🔵 Team Zoro · avg ${a1Before} · \\d+% to win\\nA-nick1 \\(C\\) <@d-a1>  Blaze [IV]+ · ${a1Before}\\n`));
  assert.deepEqual(card.payload.allowedMentions, { parse: [] }, 'cards ping nobody');
  await hub.hooks.onSync(record, match);
  assert.equal(card.edits, 0, 'nothing changed, nothing edited');
  match = { ...match, status: 'ONGOING', voting: { map: { pick: ['de_nuke'] }, location: { pick: ['Dallas'] } } };
  await hub.hooks.onSync(record, match);
  assert.equal(card.edits, 1);
  assert.match(world.text(card), /\*\*Map:\*\* Nuke · \*\*Server:\*\* Dallas[\s\S]*FACEIT: ongoing/);
  await hub.refreshBoard();
  assert.match(board.content, /\*\*Arena 12\*\* · live · Team Zoro vs Team Beta · \[match card\]\(https:\/\/discord\.com\/channels\/g1\/games\/[^)]+\)/);
  assert.equal(world.inChannel('games').filter((message) => message.content.startsWith('## 🎮')).length, 1, 'the board is edited in place');
  world.queueMembers.set('d-q1', world.member('d-q1'));
  await hub.refreshBoard();
  assert.match(queue.content, /\*\*In <#queue> \(1\):\*\* <@d-q1>/);

  // Game over (team A wins again), but FACEIT has no stats yet: the result shows, ratings wait.
  match = { ...hubMatch({ id: 'live1', winner: 'faction1', score: [13, 11], finishedMs: Date.UTC(2026, 10, 11, 0, 50), map: 'de_nuke' }), voting: match.voting };
  await store.saveArenaMatch('live1', { endingAt: new Date(clock.ms).toISOString() });
  await hub.hooks.onEnd(record, 'FINISHED');
  assert.match(world.text(card), /^🏁 Arena 12: Team Zoro win 13-11/);
  assert.match(world.text(card), /Rating changes show here once FACEIT has the match stats/);
  assert.equal(await games.has('live1'), false, 'not rated before the stats are in');
  // A minute later the stats are there: saved, rated, and the card shows every rating change.
  statsReady = true;
  clock.ms += 60_000;
  await hub.tick();
  const saved = await games.get('live1');
  assert.equal(saved.number, 12);
  assert.equal(saved.season, 8);
  assert.deepEqual(saved.voice, { a1: { joinedAt: '2026-11-11T00:05:00.000Z', leftAt: '2026-11-11T00:45:00.000Z', seconds: 2400 } }, 'voice activity, keyed by FACEIT player');
  const rated = hub.ratings().games.get('live1');
  assert.equal(rated.players.a1.before, a1Before);
  assert.equal(rated.players.a1.k, 32, 'a1 is past placement');
  assert.equal(rated.players.b1.protection, '50', 'b1 carried the losing team');
  assert.equal(rated.players.b2.protection, 'none');
  assert.equal(rated.players.b1.change * 2, rated.players.b2.change, 'half the loss');
  assert.match(world.text(card), new RegExp(`A-nick1 \\(C\\) <@d-a1>  Blaze [IV]+  \\+${rated.players.a1.change} → ${rated.players.a1.after}`));
  assert.match(world.text(card), new RegExp(`B-nick1 \\(C\\) <@d-b1>  Spark [IV]+  −${-rated.players.b1.change} → ${rated.players.b1.after} \\(loss protected, carried\\)`));
  assert.match(world.text(card), /\*\*Top fragger:\*\* B-nick1 · 33\/12\/3/);
  assert.deepEqual((await store.getArenaHubState()).pending, {});
  assert.match(board.content, /No Arena games live right now\./);
  assert.match(lb.content, new RegExp(`A-nick1  Blaze [IV]+ · ${rated.players.a1.after}`), 'the leaderboard shows the new rating');

  // A staff adjustment lifts a1 into Blaze -> Inferno: role swapped, rank-up posted (no ping).
  const replies = [];
  await hub.handleRating(interactionFor(replies, { sub: 'adjust', player: 'A-nick1', amount: 200, reason: 'test' }));
  assert.match(replies.at(-1).content, /Only Staff and Arena Admins/);
  await hub.handleRating(interactionFor(replies, { staff: true, sub: 'adjust', player: 'A-nick1', amount: 200, reason: 'event prize' }));
  assert.match(replies.at(-1).content, new RegExp(`\\*\\*A-nick1\\*\\*: \\+200 \\(event prize\\)\\. Rating ${rated.players.a1.after} → ${rated.players.a1.after + 200} · Inferno`));
  const rankUp = world.inChannel('data').at(-1);
  assert.equal(rankUp.content, '🔥 **A-nick1** (<@d-a1>) just reached **Inferno**.');
  assert.deepEqual(rankUp.payload.allowedMentions, { parse: [] });
  clock.ms += 60_000;
  await hub.tick();
  assert.deepEqual(world.roleChanges.slice(-2), ['-d-a1:Blaze', '+d-a1:Inferno'], 'exactly one rank role');
  // The first Rank X 👑 ever is a bigger post.
  await hub.handleRating(interactionFor(replies, { staff: true, sub: 'adjust', player: 'a-nick1', amount: 300, reason: 'second prize' }));
  assert.match(world.inChannel('data').at(-1).content, /^# 🔥 \*\*A-nick1\*\* \(<@d-a1>\) is the first player ever to reach Rank X 👑!$/);
  clock.ms += 60_000;
  await hub.tick();
  assert.deepEqual(world.roleChanges.slice(-2), ['-d-a1:Inferno', '+d-a1:Rank X 👑']);

  // Rating history, paged; and the recalc gives the same numbers (deterministic).
  await hub.handleRating(interactionFor(replies, { staff: true, sub: 'history', player: 'A-nick1' }));
  assert.match(replies.at(-1).content, /^## Rating history: A-nick1\n<t:\d+:d> · \*\*\+300\*\* → \d+ · staff adjust by Crown: second prize\n<t:\d+:d> · \*\*\+200\*\*/);
  assert.match(replies.at(-1).content, /Page 1 of 1 · 9 changes/);
  const before = JSON.stringify([...hub.ratings().players.values()]);
  await hub.handleRating(interactionFor(replies, { staff: true, sub: 'recalc' }));
  assert.match(replies.at(-1).content, /Recalculate every CF rating\?/);
  await hub.handleComponent(interactionFor(replies, { staff: true, customId: 'arenarc:yes' }));
  assert.match(replies.at(-1).content, /^\*\*CF ratings recalculated\*\* from 7 matches\.\n\*\*Players:\*\* 10 \(10 ranked, 0 in placement\)/);
  assert.match(replies.at(-1).content, /\*\*Top 10:\*\*\n1\. A-nick1 · Rank X 👑 · /);
  assert.equal(JSON.stringify([...hub.ratings().players.values()]), before);

  // Banned: rating kept, hidden from the leaderboard, no Rank X.
  await hub.handleRating(interactionFor(replies, { staff: true, sub: 'ban', player: 'A-nick1' }));
  assert.equal(hub.ratings().ranks.a1.label, 'Inferno I');
  clock.ms += 60_000;
  await hub.tick();
  assert.doesNotMatch(lb.content, /A-nick1/);
  await hub.handleRating(interactionFor(replies, { staff: true, sub: 'ban', player: 'A-nick1', banned: false }));

  // /arena stats: only you see it by default.
  await hub.handleStats(interactionFor(replies, {}));
  assert.deepEqual(replies.at(-2), { ephemeral: true });
  const mine = replies.at(-1).embeds[0].data;
  assert.equal(mine.title, '🎮 Arena stats: A-nick1');
  assert.match(mine.fields[0].value, /^\*\*\d+\*\* · Rank X 👑\nPeak \d+ · last 5 games: \+\d+/);
  assert.match(mine.fields[1].value, /^\*\*7\*\* games · \*\*7W–0L\*\* · 100% wins/);
  assert.match(mine.fields[2].value, /Season leaderboard: #1$/);
  await hub.handleStats(interactionFor(replies, { player: 'b-nick2', share: true }));
  assert.deepEqual(replies.at(-2), { ephemeral: false });
  assert.match(replies.at(-1).embeds[0].data.description, /Discord not linked/);
  await hub.handleStats(interactionFor(replies, { as: 'stranger' }));
  assert.match(replies.at(-1).content, /isn't linked yet/);
  await hub.handleStats(interactionFor(replies, { player: 'nobody-here' }));
  assert.match(replies.at(-1).content, /couldn't find a FACEIT player called \*\*nobody-here\*\*/);

  // Daily decay: 10 days later, a1 (inactive since the 11th) has lost 15 and it is logged.
  const peak = hub.ratings().players.get('a1').rating;
  clock.ms = zoneMidnightMs('2026-11-21', 'America/Chicago') + 6 * 60 * 60_000;
  await hub.tick();
  assert.equal(hub.ratings().players.get('a1').rating, peak - 15);
  assert.equal(hub.ratings().history.filter((row) => row.playerId === 'a1' && row.reason === 'decay').length, 3);
  assert.equal((await store.getArenaHubState()).lastDecayDay, '2026-11-21');

  // Monday noon Chicago: the recap for the week before (Nov 9 to 15), once, with the new ranks.
  clock.ms = zoneMidnightMs('2026-11-16', 'America/Chicago') + 12 * 60 * 60_000 + 60_000;
  await hub.tick();
  const recap = world.inChannel('data').at(-1);
  assert.match(recap.content, /^## 📅 Arena weekly recap · Season 8\nMon, Nov 9 to Sun, Nov 15: \*\*1\*\* game, \*\*10\*\* players/);
  assert.match(recap.content, /\*\*Top fragger:\*\* B-nick1 \(33 kills\)/);
  assert.match(recap.content, /\*\*New ranks:\*\* A-nick1 \(Inferno\), A-nick1 \(Rank X 👑\)/);
  const posts = world.inChannel('data').length;
  clock.ms += 5 * 60_000;
  await hub.tick();
  assert.equal(world.inChannel('data').length, posts, 'one recap a week');

  // A cancelled match: kept on record, its card says so, no rating change.
  const cancelledMatch = { ...hubMatch({ id: 'live2', status: 'VOTING', winner: null }), voting: {} };
  const record2 = { ...record, id: 'live2', number: 13 };
  await hub.hooks.onSync(record2, cancelledMatch);
  const card2 = world.inChannel('games').at(-1);
  match = { ...cancelledMatch, status: 'CANCELLED' };
  const ratingsBefore = JSON.stringify([...hub.ratings().players.values()]);
  await hub.hooks.onEnd(record2, 'CANCELLED');
  assert.match(world.text(card2), /^⚪ Arena 13: cancelled\n\*\*Team Zoro vs Team Beta\*\*\nMatch cancelled, no rating change\./);
  assert.equal((await games.get('live2')).status, 'cancelled');
  assert.equal(JSON.stringify([...hub.ratings().players.values()]), ratingsBefore);
  assert.deepEqual((await store.getArenaHubState()).cards, {});

  // After a restart with no memory of its pinned messages, the bot finds and reuses them.
  await store.saveArenaHubState({ boardMessageId: null, queueMessageId: null, leaderboardMessageId: null });
  const hub2 = createArenaHub({ client: world.client, faceit, config, games, ratingStore, isStaff: () => true, now: () => clock.ms });
  const before2 = world.sent.length;
  await hub2.tick();
  assert.equal(world.sent.length, before2, 'no second board, queue or leaderboard message');
  assert.equal((await store.getArenaHubState()).boardMessageId, board.id);
});

test('arena hub: stats reply has a Post in channel button; older matches get their stats refreshed', async () => {
  const world = fakeWorld();
  const clock = { ms: Date.UTC(2026, 10, 12, 1) };
  const gamesFile = path.join(tempDir, 'share-games.json');
  const games = createGameStore(gamesFile);
  // A match saved before HLTV ratings were kept: no rounds, no rating, stats version 1.
  const old = hubMatch({ id: 'older', winner: 'faction1', score: [13, 7], finishedMs: Date.UTC(2026, 10, 10, 20) });
  const saved = compactGame(old, hubStats(old), { seasons: SEASONS });
  delete saved.sv;
  delete saved.rounds;
  for (const line of saved.teams.flatMap((team) => team.players)) delete line.hr;
  await games.upsert(saved);
  const asked = [];
  const faceit = {
    request: async (requestPath) => {
      if (requestPath.startsWith('/leaderboards/hubs/hub/seasons/8')) return { items: [] };
      if (requestPath.startsWith('/leaderboards/hubs/hub?')) return { items: LEADERBOARDS };
      if (requestPath === '/hubs/hub') return { faceit_url: 'https://www.faceit.com/{lang}/hub/hub/Arena' };
      return { items: [] };
    },
    getMatchRaw: async () => old,
    getMatchStats: async (id) => {
      asked.push(id);
      const stats = hubStats(old, { kills: { b1: 30 } });
      stats.rounds[0].round_stats.Rounds = '20';
      for (const line of stats.rounds[0].teams.flatMap((team) => team.players)) Object.assign(line.player_stats, { 'Double Kills': '2', 'Triple Kills': '0', 'Quadro Kills': '0', 'Penta Kills': '0' });
      return stats;
    },
    getPlayerByNickname: async () => null
  };
  const config = { arenaEnabled: true, arenaHubId: 'hub', arenaGamesChannelId: 'games', arenaDataChannelId: 'data', arenaQueueChannelId: 'queue', arenaTeamSize: 5, arenaTimeZone: 'America/Chicago', arenaRecapTime: '12:00', arenaDecayTime: '05:00', arenaLeaderboardSize: 25, arenaBannedFaceitIds: [] };
  await store.saveArenaHubState({ backfill: { offset: 0, done: true } });
  const hub = createArenaHub({ client: world.client, faceit, config, games, ratingStore: createRatingStore(path.join(tempDir, 'share-ratings.json')), isStaff: () => false, now: () => clock.ms });

  // Before the refresh the old match has no HLTV rating, so its loss protection uses ADR.
  await hub.recompute();
  assert.equal(hub.ratings().games.get('older').players.b1.protection, 'none');
  await hub.tick();
  assert.deepEqual(asked, ['older'], 'its stats are read again from FACEIT');
  const refreshed = await games.get('older');
  assert.equal(refreshed.sv, 2);
  assert.equal(refreshed.rounds, 20);
  assert.equal(refreshed.teams[1].players[0].hr, 1.64);
  assert.equal(hub.ratings().games.get('older').players.b1.protection, '50', 'now protected by HLTV rating');
  await hub.tick();
  assert.equal(asked.length, 1, 'only once');

  // /arena stats: only you see it, with a button to post it for everyone.
  const replies = [];
  await hub.handleStats(interactionFor(replies, { as: 'd-a1' }));
  const reply = replies.at(-1);
  const button = reply.components[0].components[0].data;
  assert.equal(button.label, 'Post in channel');
  assert.equal(button.custom_id, 'arenast:a1:now');
  assert.match(reply.embeds[0].data.fields[1].value, /Rating 0\.\d\d/);
  // Anyone can press it (it is not a staff button). The card is posted publicly, pinging nobody.
  await hub.handleComponent(interactionFor(replies, { as: 'd-a1', customId: button.custom_id }));
  const shared = replies.at(-1);
  assert.equal(shared.ephemeral, false);
  assert.equal(shared.content, 'Shared by <@d-a1>');
  assert.equal(shared.embeds[0].data.title, '🎮 Arena stats: A-nick1');
  assert.deepEqual(shared.allowedMentions, { parse: [] });
  assert.equal(shared.components, undefined, 'the public copy has no button');
  // Not again straight away.
  await hub.handleComponent(interactionFor(replies, { as: 'd-a1', customId: button.custom_id }));
  assert.match(replies.at(-1).content, /You just posted one\. Try again in \d+ seconds\./);
  assert.equal(replies.at(-1).ephemeral, true);
  clock.ms += 31_000;
  await hub.handleComponent(interactionFor(replies, { as: 'd-a1', customId: button.custom_id }));
  assert.equal(replies.at(-1).ephemeral, false);
  // share:true posts it straight away, with no button needed.
  await hub.handleStats(interactionFor(replies, { as: 'd-a1', share: true }));
  assert.equal(replies.at(-1).components, undefined);
  // A season on the button is kept.
  await hub.handleStats(interactionFor(replies, { as: 'd-a1', season: 7 }));
  assert.equal(replies.at(-1).components[0].components[0].data.custom_id, 'arenast:a1:7');
});
