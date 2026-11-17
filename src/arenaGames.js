// Crossfire Arena game records: every Arena hub match, kept compact, and what is worked out
// from them (player records, the weekly recap) plus the text of the match cards, the live
// games board, the season leaderboard, the queue status and /arena stats. Pure functions and
// two small file stores; src/arenaHub.js runs Discord and FACEIT, src/arenaRating.js the rating.
//
// A match record (everything is keyed by FACEIT player id):
//   { id, hubId, number, status: 'finished' | 'cancelled', season, startedAt, finishedAt, map,
//     server, score: [a, b], winner: 0 | 1, url, hasStats,
//     rounds, sv (stats version),
//     teams: [{ label, captain, players: [{ id, n, k, d, a, adr, kd, hs, mvp, hr (HLTV Rating 1.0), left }] }],
//     voice: { [playerId]: { joinedAt, leftAt, seconds } } }
// The rating fields of a match (team averages, win chance, each player's rating before/after,
// K, loss protection, placement) come from the replay in src/arenaRating.js.

import fs from 'node:fs/promises';
import path from 'node:path';

import { arenaFaceitUrl, arenaTeams } from './arenaLogic.js';
import { hltvRating } from './arenaRating.js';
import { prettyMapName } from './matchResult.js';

// ---------- seasons (the FACEIT hub's season leaderboards) ----------

// FACEIT's leaderboard list -> [{ season, name, id, startMs, endMs, status }], oldest first.
export function hubSeasons(leaderboards = []) {
  return leaderboards
    .filter((board) => board?.leaderboard_type === 'hub_season' && Number.isFinite(Number(board.season)))
    .map((board) => ({
      season: Number(board.season),
      name: String(board.leaderboard_name || `Season ${board.season}`).trim(),
      id: board.leaderboard_id,
      startMs: Number(board.start_date) * 1000,
      endMs: Number(board.end_date) * 1000,
      status: String(board.status || '').toUpperCase()
    }))
    .sort((a, b) => a.season - b.season);
}

// The season a moment falls in, or null (between seasons).
export function seasonAt(ms, seasons = []) {
  if (!Number.isFinite(ms)) return null;
  return seasons.find((season) => ms >= season.startMs && ms < season.endMs)?.season ?? null;
}

// The season running now, or null between seasons.
export function currentSeason(seasons = [], now = Date.now()) {
  return seasons.find((season) => now >= season.startMs && now < season.endMs) || null;
}

// The newest season that has started (running or finished), or null.
export function latestSeason(seasons = [], now = Date.now()) {
  return [...seasons].reverse().find((season) => now >= season.startMs) || null;
}

// ---------- one match ----------

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const isFinished = (game) => game?.status !== 'cancelled' && [0, 1].includes(game?.winner);

function baseRecord(match, { number: gameNumber = null, voice = null, seasons = [] } = {}) {
  const finishedMs = number(match.finished_at) * 1000 || null;
  const startedMs = number(match.started_at) * 1000 || null;
  return {
    id: match.match_id,
    hubId: match.competition_id || null,
    number: gameNumber,
    season: seasonAt(finishedMs || startedMs, seasons),
    startedAt: startedMs ? new Date(startedMs).toISOString() : null,
    finishedAt: finishedMs ? new Date(finishedMs).toISOString() : null,
    server: match.voting?.location?.pick?.[0] || null,
    url: arenaFaceitUrl(match),
    ...(voice && Object.keys(voice).length ? { voice } : {})
  };
}

// A finished FACEIT hub match (+ its /stats payload) as a match record, or null when it has no
// result. extra: { number, voice, seasons }.
export function compactGame(match, stats = null, extra = {}) {
  const winnerFaction = match?.results?.winner;
  const score = match?.results?.score;
  if (!match?.match_id || !['faction1', 'faction2'].includes(winnerFaction) || !score) return null;
  const round = stats?.rounds?.[0] || null;
  const statsByPlayer = statLines(stats);
  const hasStats = statsByPlayer.size > 0;
  const totals = [number(score.faction1), number(score.faction2)];
  const rounds = number(round?.round_stats?.Rounds) || totals[0] + totals[1];
  return {
    ...baseRecord(match, extra),
    status: 'finished',
    map: prettyMapName(round?.round_stats?.Map || match.voting?.map?.pick?.[0] || ''),
    score: totals,
    winner: winnerFaction === 'faction1' ? 0 : 1,
    hasStats,
    rounds,
    sv: STATS_VERSION,
    teams: arenaTeams(match).map((team) => ({
      label: team.label,
      captain: match.teams?.[team.faction]?.leader || null,
      players: team.players.map((player) => statLine(player.playerId, player.nickname, statsByPlayer.get(player.playerId), rounds, hasStats))
    }))
  };
}

// Raised when a match's saved stats gain something (2: rounds and HLTV rating). Matches saved
// with an older version get their stats read again from FACEIT (src/arenaHub.js).
export const STATS_VERSION = 2;

function statLines(stats) {
  const lines = new Map();
  for (const team of stats?.rounds?.[0]?.teams || []) {
    for (const player of team.players || []) lines.set(player.player_id, player.player_stats || {});
  }
  return lines;
}

function statLine(id, nickname, line, rounds, hasStats) {
  const kills = number(line?.Kills);
  const deaths = number(line?.Deaths);
  return {
    id,
    n: nickname,
    k: kills,
    d: deaths,
    a: number(line?.Assists),
    adr: number(line?.ADR),
    kd: number(line?.['K/D Ratio']) || (deaths ? Math.round((kills / deaths) * 100) / 100 : kills),
    hs: number(line?.['Headshots %']),
    mvp: number(line?.MVPs),
    hr: line ? hltvRating({ kills, deaths, rounds, k2: number(line['Double Kills']), k3: number(line['Triple Kills']), k4: number(line['Quadro Kills']), k5: number(line['Penta Kills']) }) : 0,
    // On the roster but with no line in FACEIT's stats while teammates have one: they left
    // before the game was played out. Their team is treated as short-handed.
    ...(hasStats && !line ? { left: true } : {})
  };
}

// A stored finished match with its stats read again from FACEIT (same players, new numbers).
// With no stats payload the match is only marked as checked.
export function withStats(game, stats) {
  const lines = statLines(stats);
  if (!lines.size) return { ...game, sv: STATS_VERSION };
  const rounds = number(stats.rounds?.[0]?.round_stats?.Rounds) || (game.score ? game.score[0] + game.score[1] : 0);
  return {
    ...game,
    hasStats: true,
    rounds,
    sv: STATS_VERSION,
    teams: game.teams.map((team) => ({ ...team, players: team.players.map((player) => statLine(player.id, player.n, lines.get(player.id), rounds, true)) }))
  };
}

// A cancelled match: kept on record, with no result and no rating change.
export function cancelledGame(match, extra = {}) {
  if (!match?.match_id) return null;
  return {
    ...baseRecord(match, extra),
    status: 'cancelled',
    map: prettyMapName(match.voting?.map?.pick?.[0] || ''),
    score: null,
    winner: null,
    hasStats: false,
    teams: arenaTeams(match).map((team) => ({
      label: team.label,
      captain: match.teams?.[team.faction]?.leader || null,
      players: team.players.map((player) => ({ id: player.playerId, n: player.nickname }))
    }))
  };
}

// The player with the most kills in a game: { n, k, d, a } or null (no stats).
export function topFragger(game) {
  const players = (game?.teams || []).flatMap((team) => team.players || []);
  const best = players.reduce((top, player) => (!top || player.k > top.k || (player.k === top.k && player.d < top.d) ? player : top), null);
  return best && best.k > 0 ? best : null;
}

const byFinish = (a, b) => (Date.parse(a.finishedAt || '') || 0) - (Date.parse(b.finishedAt || '') || 0);

// ---------- a player's record ----------

// season: a number for one season, null for all time. ratings: the replay's per-game results
// (Map gameId -> { players: { [id]: { change, protection } } }), for the rating change per game.
export function playerRecord(games, playerId, { season = null, ratings = null } = {}) {
  const record = { played: 0, won: 0, lost: 0, kills: 0, deaths: 0, assists: 0, adrTotal: 0, withStats: 0, hrTotal: 0, withRating: 0, bestStreak: 0, streak: 0, nickname: null, last: [] };
  let run = 0;
  for (const game of games.filter(isFinished).sort(byFinish)) {
    if (season !== null && game.season !== season) continue;
    const teamIndex = (game.teams || []).findIndex((team) => (team.players || []).some((player) => player.id === playerId));
    if (teamIndex < 0) continue;
    const line = game.teams[teamIndex].players.find((player) => player.id === playerId);
    const won = game.winner === teamIndex;
    record.played += 1;
    record.won += won ? 1 : 0;
    record.lost += won ? 0 : 1;
    record.nickname = line.n || record.nickname;
    if (game.hasStats !== false && (line.k || line.d)) {
      record.kills += line.k;
      record.deaths += line.d;
      record.assists += line.a;
      record.adrTotal += line.adr;
      record.withStats += 1;
    }
    if (line.hr > 0) {
      record.hrTotal += line.hr;
      record.withRating += 1;
    }
    run = won ? Math.max(run, 0) + 1 : Math.min(run, 0) - 1;
    if (run > record.bestStreak) record.bestStreak = run;
    const rated = ratings?.get?.(game.id)?.players?.[playerId] || null;
    record.last.push({
      won,
      map: game.map,
      score: `${game.score[teamIndex]}-${game.score[1 - teamIndex]}`,
      k: line.k,
      d: line.d,
      a: line.a,
      adr: line.adr,
      hr: line.hr || 0,
      finishedAt: game.finishedAt,
      url: game.url,
      season: game.season,
      change: rated ? rated.change : null,
      protection: rated ? rated.protection : 'none'
    });
  }
  record.streak = run; // > 0 wins in a row now, < 0 losses in a row
  record.winRate = record.played ? record.won / record.played : 0;
  record.kd = record.deaths ? record.kills / record.deaths : record.kills;
  record.adr = record.withStats ? record.adrTotal / record.withStats : 0;
  record.hr = record.withRating ? record.hrTotal / record.withRating : 0;
  record.last = record.last.slice(-5).reverse();
  return record;
}

// The seasons a player has games in, newest first.
export function playerSeasons(games, playerId) {
  const seasons = new Set();
  for (const game of games.filter(isFinished)) {
    if (game.season === null || game.season === undefined) continue;
    if ((game.teams || []).some((team) => (team.players || []).some((player) => player.id === playerId))) seasons.add(game.season);
  }
  return [...seasons].sort((a, b) => b - a);
}

// The FACEIT player id for a nickname seen in any stored game (case-insensitive), or null.
export function playerIdByNickname(games, nickname) {
  const wanted = String(nickname || '').trim().toLowerCase();
  if (!wanted) return null;
  for (const game of [...games].sort(byFinish).reverse()) {
    for (const team of game.teams || []) {
      const found = (team.players || []).find((player) => String(player.n || '').toLowerCase() === wanted);
      if (found) return found.id;
    }
  }
  return null;
}

// ---------- the weekly recap ----------

// Games finished in [fromMs, toMs) in one season: who played and won the most, the best win
// streak, the top fragger and the biggest rating gain. Each is { names: [...], value } (ties
// share it) or null. ratings: the replay's per-game results, for the rating gain.
export function weeklyRecap(games, { fromMs, toMs, season = null, ratings = null } = {}) {
  const week = games
    .filter(isFinished)
    .filter((game) => {
      const finished = Date.parse(game.finishedAt || '');
      return Number.isFinite(finished) && finished >= fromMs && finished < toMs && (season === null || game.season === season);
    })
    .sort(byFinish);
  const players = new Map();
  for (const game of week) {
    game.teams.forEach((team, teamIndex) => {
      for (const line of team.players || []) {
        const entry = players.get(line.id) || { name: line.n, games: 0, wins: 0, kills: 0, run: 0, bestStreak: 0, gain: 0 };
        const won = game.winner === teamIndex;
        entry.name = line.n || entry.name;
        entry.games += 1;
        entry.wins += won ? 1 : 0;
        entry.kills += line.k || 0;
        entry.run = won ? entry.run + 1 : 0;
        entry.bestStreak = Math.max(entry.bestStreak, entry.run);
        entry.gain += ratings?.get?.(game.id)?.players?.[line.id]?.change || 0;
        players.set(line.id, entry);
      }
    });
  }
  const top = (key) => {
    const best = Math.max(0, ...[...players.values()].map((entry) => entry[key]));
    if (!best) return null;
    return { names: [...players.values()].filter((entry) => entry[key] === best).map((entry) => entry.name).sort((a, b) => a.localeCompare(b)), value: best };
  };
  return {
    games: week.length,
    players: players.size,
    mostGames: top('games'),
    mostWins: top('wins'),
    bestStreak: top('bestStreak'),
    topFragger: top('kills'),
    biggestGain: top('gain')
  };
}

// ---------- text ----------

const namesText = (entry, shown = 3) => (entry.names.length > shown ? `${entry.names.slice(0, shown).join(', ')} +${entry.names.length - shown} more` : entry.names.join(', '));
const esc = (text) => String(text ?? '').replace(/([\\*_~`|>])/g, '\\$1');
const signed = (value) => (value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '±0');

// "Mon, Nov 9" in the recap's time zone.
function dayText(ms, timeZone = 'America/Chicago') {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(ms));
}

// The weekly recap post (plain text), or null when no games were played.
//   rankUps: [{ nickname, rank }] reached during the week.
export function recapText(recap, { fromMs, toMs, seasonName = null, rankUps = [], timeZone = 'America/Chicago' } = {}) {
  if (!recap?.games) return null;
  const line = (label, entry, unit) => (entry ? `**${label}:** ${esc(namesText(entry))} (${unit(entry.value)})` : null);
  const count = (one, many) => (value) => `${value} ${value === 1 ? one : many}`;
  return [
    `## 📅 Arena weekly recap${seasonName ? ` · ${seasonName}` : ''}`,
    `${dayText(fromMs, timeZone)} to ${dayText(toMs - 1, timeZone)}: **${recap.games}** game${recap.games === 1 ? '' : 's'}, **${recap.players}** player${recap.players === 1 ? '' : 's'}`,
    '',
    line('Most games', recap.mostGames, count('game', 'games')),
    line('Most wins', recap.mostWins, count('win', 'wins')),
    line('Best win streak', recap.bestStreak, (value) => `${value} in a row`),
    line('Top fragger', recap.topFragger, count('kill', 'kills')),
    line('Biggest rating gain', recap.biggestGain, (value) => `+${value}`),
    rankUps.length ? `**New ranks:** ${rankUps.slice(0, 12).map((entry) => `${esc(entry.nickname)} (${entry.rank})`).join(', ')}${rankUps.length > 12 ? ` +${rankUps.length - 12} more` : ''}` : null
  ].filter((entry) => entry !== null).join('\n').slice(0, 2000);
}

// ---------- match cards ----------

// A lineup table for the draft and live match cards (a code block, so the columns line up):
// best CF rating first, players still placing after them, with how each has played in Arena.
//   "Player          Rank          CFR   GP  Win%   Rtg"
//   "A_nick1 (C)     Blaze II     1185   43   58%  1.08"
// wide (the draft card) adds K/D and ADR before Rtg.
//   records: { [playerId]: playerRecord(...) } (all time)
function lineupTable(team, { ranks = {}, ratings = {}, records = {}, placementGames = 5, wide = false, empty = 'No players' } = {}) {
  const text = (value) => String(value ?? '').replace(/`/g, "'");
  const row = (name, rank, cfr, games, win, kd, adr, hr) => [
    `${text(name).slice(0, 15).padEnd(15)} ${text(rank).slice(0, 11).padEnd(11)}${text(cfr).padStart(6)}${text(games).padStart(5)}${text(win).padStart(6)}`,
    wide ? `${text(kd).padStart(6)}${text(adr).padStart(5)}` : '',
    text(hr).padStart(6)
  ].join('').trimEnd();
  const idOf = (player) => player.playerId || player.id;
  const ranked = (player) => Boolean(ranks[idOf(player)] && !ranks[idOf(player)].placing);
  const players = [...(team.players || [])].sort((a, b) => Number(ranked(b)) - Number(ranked(a))
    || (ratings[idOf(b)] ?? 0) - (ratings[idOf(a)] ?? 0)
    || (records[idOf(b)]?.played || 0) - (records[idOf(a)]?.played || 0));
  const lines = players.map((player) => {
    const id = idOf(player);
    const record = records[id];
    return row(
      `${player.nickname || player.n}${team.captain && team.captain === id ? ' (C)' : ''}`,
      ranked(player) ? String(ranks[id].label).replace(/\s*👑/u, '') : (ranks[id]?.label || `Placing 0/${placementGames}`),
      ranked(player) ? ratings[id] : '-',
      record?.played || '-',
      record?.played ? `${Math.round(record.winRate * 100)}%` : '-',
      record?.withStats ? record.kd.toFixed(2) : '-',
      record?.withStats ? Math.round(record.adr) : '-',
      record?.hr ? record.hr.toFixed(2) : '-'
    );
  });
  if (!lines.length) return empty;
  return ['```', row('Player', 'Rank', 'CFR', 'GP', 'Win%', 'K/D', 'ADR', 'Rtg'), ...lines, '```'].join('\n');
}

// One team's scoreboard on the finished match card (a code block, so the columns line up):
// most kills first, with each player's CF rating change at the end of the row.
//   "Player            K   D   A  ADR   Rtg  CFR"
//   "A_nick1 (C)      20  10   2   98  1.41  +16 > 1201"
function scoreboard(team, { result = null, placementGames = 5 } = {}) {
  const text = (value) => String(value ?? '').replace(/`/g, "'");
  const row = (name, k, d, a, adr, hr, change) => `${text(name).slice(0, 15).padEnd(15)}${text(k).padStart(4)}${text(d).padStart(4)}${text(a).padStart(4)}${text(adr).padStart(5)}${text(hr).padStart(6)}  ${text(change)}`.trimEnd();
  const lines = [...(team.players || [])].sort((a, b) => (b.k || 0) - (a.k || 0) || (a.d || 0) - (b.d || 0)).map((player) => {
    const rated = result?.players?.[player.id] || null;
    const played = Boolean(player.k || player.d);
    const change = !rated
      ? ''
      : rated.placement && rated.gameNumber < placementGames
        ? `Placing ${rated.gameNumber}/${placementGames}`
        : `${signed(rated.change)} > ${rated.after}${['50', '75', 'short'].includes(rated.protection) ? ' *' : ''}`;
    return row(
      `${player.n}${team.captain && team.captain === player.id ? ' (C)' : ''}`,
      played ? player.k : '-',
      played ? player.d : '-',
      played ? player.a : '-',
      played && player.adr ? Math.round(player.adr) : '-',
      player.hr ? player.hr.toFixed(2) : '-',
      change
    );
  });
  return ['```', row('Player', 'K', 'D', 'A', 'ADR', 'Rtg', 'CFR'), ...lines, '```'].join('\n');
}

// A match card (embed data).
//   stage 'live':      { number, teams: [{ label, captain, players: [{ playerId, nickname }] }], map, server, url, status,
//                        teamAvg: [a, b], expected: [a, b] }
//   stage 'finished':  { game, result } result = the replay's entry for this game (may be null: stats still to come)
//   stage 'cancelled'
// ranks: { [playerId]: { label, placing } }   ratings: { [playerId]: rating }   links: { [playerId]: { discordId } }
export function matchCard({ stage, number: gameNumber, teams = [], map = null, server = null, url = null, status = null, game = null, result = null, teamAvg = null, expected = null, ranks = {}, ratings = {}, links = {}, records = {}, placementGames = 5, pending = false }) {
  const title = `Arena ${gameNumber ?? ''}`.trim();
  const names = teams.map((team) => team.label).join(' vs ');
  const idOf = (player) => player.playerId || player.id;
  const nameOf = (player) => player.nickname || player.n;
  const marker = (index) => (index === 0 ? '🔵' : '🔴');

  if (stage === 'finished' && game) {
    const fragger = topFragger(game);
    return {
      title: `🏁 ${title}: ${game.teams[game.winner].label} win ${game.score[game.winner]}-${game.score[1 - game.winner]}`.slice(0, 256),
      description: [
        `**${esc(names)}**`,
        [game.map ? `**Map:** ${game.map}` : null, game.url ? `[FACEIT match room](${game.url})` : null].filter(Boolean).join(' · '),
        fragger ? `**Top fragger:** ${esc(fragger.n)} · ${fragger.k}/${fragger.d}/${fragger.a}` : null,
        pending ? '_Rating changes show here once FACEIT has the match stats._' : (Object.values(result?.players || {}).some((entry) => ['50', '75', 'short'].includes(entry.protection)) ? '-# CFR is the CF rating change. * loss protected' : '-# CFR is the CF rating change.')
      ].filter(Boolean).join('\n'),
      fields: teams.map((team, index) => ({
        name: `${marker(index)} ${team.label} · ${game.score[index]}${game.winner === index ? ' 🏆' : ''}`.slice(0, 256),
        value: (pending ? lineupTable(team, { ranks, ratings, records, placementGames }) : scoreboard(team, { result, placementGames })).slice(0, 1024),
        inline: false
      })),
      color: 0x2ecc71
    };
  }
  if (stage === 'cancelled') {
    return {
      title: `⚪ ${title}: cancelled`.slice(0, 256),
      description: [`**${esc(names)}**`, 'Match cancelled, no rating change.', url ? `[FACEIT match room](${url})` : null].filter(Boolean).join('\n'),
      fields: [],
      color: 0x95a5a6
    };
  }
  const details = [map ? `**Map:** ${map}` : null, url ? `[FACEIT match room](${url})` : null].filter(Boolean).join(' · ');
  return {
    title: `🔴 ${title}: live`.slice(0, 256),
    description: [`**${esc(names)}**`, details || null, status ? `FACEIT: ${String(status).toLowerCase().replace(/_/g, ' ')}` : null, '-# CFR is CF rating. GP, Win% and Rtg (Rating) are from all Arena games.'].filter(Boolean).join('\n'),
    fields: teams.map((team, index) => ({
      name: `${marker(index)} ${team.label}${teamAvg ? ` · avg ${teamAvg[index]}` : ''}${expected ? ` · ${Math.round(expected[index] * 100)}% to win` : ''}`.slice(0, 256),
      value: lineupTable(team, { ranks, ratings, records, placementGames }).slice(0, 1024),
      inline: false
    })),
    color: 0xff5500
  };
}

// The card posted when a game pops and the captains are picking (embed data), laid out like
// the live and finished cards: a table of the players not picked yet, then one per team so
// far, with everyone's CF rating and Arena stats. It is edited as players are picked, and
// becomes the live match card when the draft is done.
//   teams: [{ label, captain, players: [{ playerId, nickname }] }]   (who FACEIT lists so far)
//   pool: [{ playerId, nickname }] the players nobody has picked yet
//   records: { [playerId]: playerRecord(...) }   ranks / ratings: as for matchCard
export function draftCard({ teams = [], pool = [], url = null, ranks = {}, ratings = {}, records = {}, teamSize = 5, placementGames = 5 }) {
  const marker = (index) => (index === 0 ? '🔵' : '🔴');
  const table = (team, empty) => lineupTable(team, { ranks, ratings, records, placementGames, wide: true, empty }).slice(0, 1024);
  return {
    title: '🟡 New Arena game: captains are picking',
    description: [
      `**${esc(teams.map((team) => team.label).join(' vs '))}**`,
      url ? `[FACEIT match room](${url})` : null,
      '-# CFR is CF rating. GP, Win%, K/D, ADR and Rtg (Rating) are from all Arena games.'
    ].filter(Boolean).join('\n'),
    fields: [
      ...(pool.length ? [{ name: `⚪ Not picked yet · ${pool.length}`, value: table({ players: pool }, 'Nobody'), inline: false }] : []),
      ...teams.map((team, index) => ({
        name: `${marker(index)} ${team.label} · ${(team.players || []).length}/${teamSize}`.slice(0, 256),
        value: table(team, 'Nobody yet'),
        inline: false
      }))
    ],
    color: 0xf1c40f
  };
}

// ---------- pinned messages ----------

export const BOARD_HEADING = '## 🎮 Arena: live games';
export const QUEUE_HEADING = '## ⏳ Arena queue';
export const LEADERBOARD_HEADING = '## 🏆 Arena season leaderboard';
export const RATING_BOARD_HEADING = '## 🔥 CF Rating leaderboard';

// The pinned live games board (plain text): every match drafting or live.
//   games: [{ number, stage: 'drafting' | 'live', teams: [{ label }], map, score, cardUrl, url }]
export function liveBoardText({ games = [] }) {
  const lines = [BOARD_HEADING];
  if (!games.length) lines.push('No Arena games live right now.');
  for (const game of games) {
    const teams = (game.teams || []).map((team) => team.label).join(' vs ') || 'Teams being drafted';
    lines.push([
      `**${game.number ? `Arena ${game.number}` : 'New game'}** · ${game.stage === 'drafting' ? 'drafting' : 'live'}`,
      esc(teams),
      game.map || null,
      game.score || null,
      game.cardUrl ? `[match card](${game.cardUrl})` : (game.url ? `[match room](<${game.url}>)` : null)
    ].filter(Boolean).join(' · '));
  }
  return lines.join('\n').slice(0, 2000);
}

// The pinned queue status (plain text). FACEIT's API does not say who is waiting in the hub
// queue, so this lists who is in the Queue voice channel.
export function queueText({ queue = [], queueChannelId = null, source = 'voice' }) {
  const where = queueChannelId ? `<#${queueChannelId}>` : 'the Queue voice channel';
  return [
    QUEUE_HEADING,
    queue.length
      ? `**In ${where} (${queue.length}):** ${queue.slice(0, 30).map((id) => `<@${id}>`).join(' ')}${queue.length > 30 ? ` +${queue.length - 30} more` : ''}`
      : `Nobody is in ${where} right now.`,
    source === 'voice' ? '-# FACEIT does not share who is in its queue, so this shows the Queue voice channel.' : null
  ].filter(Boolean).join('\n').slice(0, 2000);
}

// The pinned season leaderboard (plain text): the FACEIT hub's standings, each row with the
// player's CF rating and rank. Placement and banned players are left out.
//   items: FACEIT leaderboard rows   ranks: { [playerId]: { label, placing } }   ratings: { [playerId]: rating }
export function leaderboardText({ name, items = [], ranks = {}, ratings = {}, banned = new Set(), running = true, url = null, limit = 25 }) {
  const shown = items.filter((row) => {
    const id = row.player?.user_id;
    return id && !banned.has(id) && ranks[id] && !ranks[id].placing;
  }).slice(0, limit);
  const rows = shown.map((row, index) => {
    const id = row.player.user_id;
    return boardRow(index + 1, row.player.nickname || '?', ranks[id].label, ratings[id] ?? '-', row.won, row.lost);
  });
  const build = (list) => [
    `${LEADERBOARD_HEADING} · ${name}${running ? '' : ' (final)'}`,
    ...(list.length ? ['```', BOARD_COLUMNS, ...list, '```'] : ['Nobody is ranked this season yet.', '']),
    url ? `**Full standings:** <${url}>` : null,
    '-# Season standings from FACEIT (W-L is this season); CFR is CF rating, which is permanent.'
  ].filter((line) => line !== null).join('\n');
  let list = rows;
  while (list.length > 3 && build(list).length > 2000) list = list.slice(0, -1);
  return build(list).slice(0, 2000);
}

// One row of a leaderboard table (inside a code block, so the columns line up).
const tableCell = (text, width) => String(text ?? '').replace(/`/g, "'").slice(0, width).padEnd(width);
const tableNum = (text, width) => String(text ?? '').padStart(width);
function boardCells(place, nickname, rank, rating, record, win) {


  // The crown would push the columns out of line; #1 already says it.
  return `${tableNum(place, 2)}  ${tableCell(nickname, 16)}  ${tableCell(String(rank || '').replace(/\s*👑/u, ''), 11)}${tableNum(rating, 5)}${tableNum(record, 9)}${tableNum(win, 6)}`;
}
function boardRow(place, nickname, rank, rating, won, lost) {
  const wins = Number(won) || 0;
  const played = wins + (Number(lost) || 0);
  return boardCells(place, nickname, rank, rating, `${wins}-${Number(lost) || 0}`, played ? `${Math.round((wins / played) * 100)}%` : '-');
}
const BOARD_COLUMNS = boardCells(' #', 'Player', 'Rank', 'CFR', 'W-L', 'Win%');

// The pinned CF Rating leaderboard (plain text): the highest ratings of all time, whatever the
// season. Placement and banned players are left out.
//   players: [{ id, nickname, rating, wins, losses, games }]   ranks: { [playerId]: { label, placing } }
export function ratingBoardText({ players = [], ranks = {}, banned = new Set(), limit = 20 }) {
  const shown = players
    .filter((player) => !banned.has(player.id) && ranks[player.id] && !ranks[player.id].placing)
    .sort((a, b) => b.rating - a.rating || (b.wins || 0) - (a.wins || 0) || (b.games || 0) - (a.games || 0) || String(a.id).localeCompare(String(b.id)))
    .slice(0, limit);
  const rows = shown.map((player, index) => boardRow(index + 1, player.nickname || '?', ranks[player.id].label, player.rating, player.wins, player.losses));
  const build = (list) => [
    `${RATING_BOARD_HEADING} · top ${limit}`,
    ...(list.length ? ['```', BOARD_COLUMNS, ...list, '```'] : ['Nobody is ranked yet.', '']),
    '-# CFR is CF rating: permanent, it does not reset with seasons. W-L is all time.'
  ].join('\n');
  let list = rows;
  while (list.length > 3 && build(list).length > 2000) list = list.slice(0, -1);
  return build(list).slice(0, 2000);
}

// ---------- /arena stats ----------

// The card for one player (embed data).
//   rating: { rating, peak, games } | null      rank: { label, placing }
//   allTime / season: playerRecord(...)         position: season leaderboard place | null
//   decay: decayStatus(...)
export function statsCard({ nickname, discordId = null, faceitUrl = null, rating = null, rank = null, allTime, season = null, seasonName = null, position = null, decay = null, loading = false }) {
  const record = (entry, extra = []) => (entry.played
    ? [
        `**${entry.played}** game${entry.played === 1 ? '' : 's'} · **${entry.won}W–${entry.lost}L** · ${Math.round(entry.winRate * 100)}% wins`,
        entry.withStats ? `K/D ${entry.kd.toFixed(2)} · ADR ${Math.round(entry.adr)}${entry.hr ? ` · Rating ${entry.hr.toFixed(2)}` : ''}` : null,
        ...extra
      ].filter(Boolean).join('\n')
    : 'No games.');
  const lastChange = (allTime.last || []).reduce((sum, game) => sum + (game.change || 0), 0);
  const fields = [];
  if (rating) {
    fields.push({
      name: 'CF rating',
      value: [
        rank?.placing ? `**${rank.label}** (unranked until placement is done)` : `**${rating.rating}** · ${rank?.label || ''}`,
        `Peak ${rating.peak}${allTime.last?.length ? ` · last ${allTime.last.length} game${allTime.last.length === 1 ? '' : 's'}: ${signed(lastChange)}` : ''}`,
        decay?.state === 'grace' ? `Decay starts in ${decay.daysUntil} day${decay.daysUntil === 1 ? '' : 's'} without a game.` : null,
        decay?.state === 'decaying' ? `Decaying: −${decay.lost} so far. Play a game to stop it.` : null,
        decay?.state === 'capped' ? `Decayed −${decay.lost} (the most for one break). Play a game to reset it.` : null,
        decay?.state === 'floor' ? `Decayed −${decay.lost} down to the floor.` : null
      ].filter(Boolean).join('\n'),
      inline: false
    });
  }
  const streak = allTime.streak > 1 ? `Current streak: ${allTime.streak} wins` : allTime.streak < -1 ? `Current streak: ${-allTime.streak} losses` : null;
  fields.push({ name: 'All time', value: record(allTime, [allTime.bestStreak > 1 ? `Best win streak: ${allTime.bestStreak}` : null, streak]), inline: true });
  if (season) fields.push({ name: seasonName || 'Season', value: record(season, [position ? `Season leaderboard: #${position}` : null]), inline: true });
  const last = (allTime.last || []).map((game) => [
    game.won ? '🟢 W' : '🔴 L',
    game.map || 'map?',
    game.score,
    `${game.k}-${game.d}`,
    game.hr ? `${game.hr.toFixed(2)} rating` : (game.adr ? `ADR ${Math.round(game.adr)}` : null),
    game.change === null ? null : `${signed(game.change)}${['50', '75', 'short'].includes(game.protection) ? ' 🛡️' : ''}`
  ].filter(Boolean).join(' · '));
  if (last.length) fields.push({ name: `Last ${last.length} game${last.length === 1 ? '' : 's'}`, value: `${last.join('\n')}${last.some((line) => line.includes('🛡️')) ? '\n-# 🛡️ loss protected' : ''}`.slice(0, 1024), inline: false });
  return {
    title: `🎮 Arena stats: ${nickname}`.slice(0, 256),
    description: [
      [faceitUrl ? `[FACEIT profile](${faceitUrl})` : null, discordId ? `<@${discordId}>` : 'Discord not linked'].filter(Boolean).join(' · '),
      loading ? '_Older games are still being loaded from FACEIT, so these numbers are not final yet._' : null
    ].filter(Boolean).join('\n'),
    fields,
    color: 0xff5500
  };
}

// One page of a player's rating history (plain text).
export function historyPageText({ nickname, rows = [], page = 0, perPage = 10, gameUrls = {} }) {
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const current = Math.min(Math.max(0, page), pages - 1);
  const newestFirst = [...rows].reverse().slice(current * perPage, (current + 1) * perPage);
  const lines = newestFirst.map((row) => {
    const when = `<t:${Math.floor(row.at / 1000)}:d>`;
    const what = row.reason === 'match'
      ? (gameUrls[row.matchId] ? `[match](<${gameUrls[row.matchId]}>)` : 'match')
      : row.reason === 'staff_adjust'
        ? `staff adjust${row.staffTag ? ` by ${esc(row.staffTag)}` : ''}${row.note ? `: ${esc(row.note)}` : ''}`
        : row.reason;
    return `${when} · **${signed(row.change)}** → ${row.after} · ${what}`;
  });
  return {
    page: current,
    pages,
    content: [`## Rating history: ${esc(nickname)}`, ...(lines.length ? lines : ['No rating changes yet.']), `-# Page ${current + 1} of ${pages} · ${rows.length} change${rows.length === 1 ? '' : 's'}, newest first`].join('\n').slice(0, 2000)
  };
}

// ---------- the files ----------

// Matches and rating inputs live in their own files (thousands of matches would slow the
// bot's main data file down).
function dataFile(envName, fileName) {
  if (process.env[envName]) return path.resolve(process.env[envName]);
  return path.join(path.dirname(path.resolve(process.env.BOT_DATA_PATH || 'bot-data.json')), fileName);
}

export const arenaGamesPath = () => dataFile('ARENA_GAMES_PATH', 'arena-games.json');
export const arenaRatingsPath = () => dataFile('ARENA_RATINGS_PATH', 'arena-ratings.json');

function createJsonFile(filePath, emptyValue) {
  let data = null;
  let writing = Promise.resolve();
  async function load() {
    if (data) return data;
    try {
      data = JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') console.error(`[Arena] could not read ${filePath}: ${error.message}`);
      data = emptyValue();
    }
    return data;
  }
  function write() {
    writing = writing.then(async () => {
      await fs.writeFile(`${filePath}.tmp`, JSON.stringify(data));
      await fs.rename(`${filePath}.tmp`, filePath);
    }).catch((error) => console.error(`[Arena] could not write ${filePath}: ${error.message}`));
    return writing;
  }
  return { load, write };
}

export function createGameStore(filePath = arenaGamesPath()) {
  const file = createJsonFile(filePath, () => ({ version: 1, games: {} }));
  const games = async () => (await file.load()).games;
  return {
    async all() { return Object.values(await games()); },
    async get(id) { return (await games())[id] || null; },
    async has(id) { return Boolean((await games())[id]); },
    async count() { return Object.keys(await games()).length; },
    // New matches are added; a stored match keeps its number and voice activity when re-read.
    async upsert(records) {
      const map = await games();
      for (const record of [].concat(records).filter(Boolean)) {
        const existing = map[record.id];
        map[record.id] = { ...existing, ...record, number: record.number ?? existing?.number ?? null, ...(existing?.voice && !record.voice ? { voice: existing.voice } : {}) };
      }
      await file.write();
    }
  };
}

// What the rating is replayed from besides the matches, and what was announced:
//   { adjustments: [{ id, at, playerId, amount, reason, staffId, staffTag }], banned: { [playerId]: true },
//     rankUps: [{ at, playerId, nickname, rank }], firsts: { rankx, crown } }
export function createRatingStore(filePath = arenaRatingsPath()) {
  const file = createJsonFile(filePath, () => ({ version: 1, adjustments: [], banned: {}, rankUps: [], firsts: {} }));
  return {
    async get() {
      const data = await file.load();
      return { adjustments: data.adjustments || [], banned: data.banned || {}, rankUps: data.rankUps || [], firsts: data.firsts || {} };
    },
    async update(change) {
      const data = await file.load();
      data.adjustments = data.adjustments || [];
      data.banned = data.banned || {};
      data.rankUps = data.rankUps || [];
      data.firsts = data.firsts || {};
      const result = await change(data);
      await file.write();
      return result;
    }
  };
}
