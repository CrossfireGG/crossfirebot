// Crossfire Arena game records: every Arena hub match, kept compact, and what is worked out
// from them (player records, the weekly recap) plus the text of the match cards, the live
// games board, the season leaderboard, the queue status and /arena stats. Pure functions and
// two small file stores; src/arenaHub.js runs Discord and FACEIT, src/arenaRating.js the rating.
//
// A match record (everything is keyed by FACEIT player id):
//   { id, hubId, number, status: 'finished' | 'cancelled', season, startedAt, finishedAt, map,
//     server, score: [a, b], winner: 0 | 1, url, hasStats,
//     teams: [{ label, captain, players: [{ id, n, k, d, a, adr, kd, hs, mvp, left }] }],
//     voice: { [playerId]: { joinedAt, leftAt, seconds } } }
// The rating fields of a match (team averages, win chance, each player's rating before/after,
// K, loss protection, placement) come from the replay in src/arenaRating.js.

import fs from 'node:fs/promises';
import path from 'node:path';

import { arenaFaceitUrl, arenaTeams } from './arenaLogic.js';
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
  const statsByPlayer = new Map();
  for (const team of round?.teams || []) {
    for (const player of team.players || []) statsByPlayer.set(player.player_id, player.player_stats || {});
  }
  const hasStats = statsByPlayer.size > 0;
  return {
    ...baseRecord(match, extra),
    status: 'finished',
    map: prettyMapName(round?.round_stats?.Map || match.voting?.map?.pick?.[0] || ''),
    score: [number(score.faction1), number(score.faction2)],
    winner: winnerFaction === 'faction1' ? 0 : 1,
    hasStats,
    teams: arenaTeams(match).map((team) => ({
      label: team.label,
      captain: match.teams?.[team.faction]?.leader || null,
      players: team.players.map((player) => {
        const line = statsByPlayer.get(player.playerId);
        const kills = number(line?.Kills);
        const deaths = number(line?.Deaths);
        return {
          id: player.playerId,
          n: player.nickname,
          k: kills,
          d: deaths,
          a: number(line?.Assists),
          adr: number(line?.ADR),
          kd: number(line?.['K/D Ratio']) || (deaths ? Math.round((kills / deaths) * 100) / 100 : kills),
          hs: number(line?.['Headshots %']),
          mvp: number(line?.MVPs),
          // On the roster but with no line in FACEIT's stats while teammates have one: they
          // left before the game was played out. Their team is treated as short-handed.
          ...(hasStats && !line ? { left: true } : {})
        };
      })
    }))
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
  const record = { played: 0, won: 0, lost: 0, kills: 0, deaths: 0, assists: 0, adrTotal: 0, withStats: 0, bestStreak: 0, streak: 0, nickname: null, last: [] };
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

// One player's line on a card.
//   before the game: "Name  Blaze II · 1185"   /  "Name  Placing 3/5"
//   after the game:  "Name  Blaze II  +16 → 1201"  /  "… −8 → 1291 (loss protected, carried)"
function playerLine(name, { rank = null, rating = null, rated = null, captain = false, discordId = null, placementGames = 5 } = {}) {
  const who = `${esc(name)}${captain ? ' (C)' : ''}${discordId ? ` <@${discordId}>` : ''}`;
  if (rated) {
    // Still placing after this game: no rating shown yet.
    if (rated.placement && rated.gameNumber < placementGames) return `${who}  Placing ${rated.gameNumber}/${placementGames}`;
    const note = rated.protection === 'short' ? ' (loss protected, 4v5)' : ['50', '75'].includes(rated.protection) ? ' (loss protected, carried)' : '';
    return `${who}  ${rank?.label || ''}  ${signed(rated.change)} → ${rated.after}${note}`.replace(/ {3,}/g, '  ');
  }
  if (!rank || rank.placing) return `${who}  ${rank?.label || `Placing 0/${placementGames}`}`;
  return `${who}  ${rank.label} · ${rating}`;
}

// A match card (embed data).
//   stage 'live':      { number, teams: [{ label, captain, players: [{ playerId, nickname }] }], map, server, url, status,
//                        teamAvg: [a, b], expected: [a, b] }
//   stage 'finished':  { game, result } result = the replay's entry for this game (may be null: stats still to come)
//   stage 'cancelled'
// ranks: { [playerId]: { label, placing } }   ratings: { [playerId]: rating }   links: { [playerId]: { discordId } }
export function matchCard({ stage, number: gameNumber, teams = [], map = null, server = null, url = null, status = null, game = null, result = null, teamAvg = null, expected = null, ranks = {}, ratings = {}, links = {}, placementGames = 5, pending = false }) {
  const title = `Arena ${gameNumber ?? ''}`.trim();
  const names = teams.map((team) => team.label).join(' vs ');
  const idOf = (player) => player.playerId || player.id;
  const nameOf = (player) => player.nickname || player.n;
  const roster = (team, rated) => (team.players || []).map((player) => playerLine(nameOf(player), {
    rank: ranks[idOf(player)],
    rating: ratings[idOf(player)],
    rated: rated ? (result?.players?.[idOf(player)] || null) : null,
    captain: team.captain && team.captain === idOf(player),
    discordId: links[idOf(player)]?.discordId || null,
    placementGames
  })).join('\n') || 'No players';
  const marker = (index) => (index === 0 ? '🔵' : '🔴');

  if (stage === 'finished' && game) {
    const fragger = topFragger(game);
    return {
      title: `🏁 ${title}: ${game.teams[game.winner].label} win ${game.score[game.winner]}-${game.score[1 - game.winner]}`.slice(0, 256),
      description: [
        `**${esc(names)}**`,
        [game.map ? `**Map:** ${game.map}` : null, game.server ? `**Server:** ${game.server}` : null, game.url ? `[FACEIT match room](${game.url})` : null].filter(Boolean).join(' · '),
        fragger ? `**Top fragger:** ${esc(fragger.n)} · ${fragger.k}/${fragger.d}/${fragger.a}` : null,
        pending ? '_Rating changes show here once FACEIT has the match stats._' : null
      ].filter(Boolean).join('\n'),
      fields: teams.map((team, index) => ({
        name: `${marker(index)} ${team.label} · ${game.score[index]}${game.winner === index ? ' 🏆' : ''}`.slice(0, 256),
        value: roster(team, !pending).slice(0, 1024),
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
  const details = [map ? `**Map:** ${map}` : null, server ? `**Server:** ${server}` : null, url ? `[FACEIT match room](${url})` : null].filter(Boolean).join(' · ');
  return {
    title: `🔴 ${title}: live`.slice(0, 256),
    description: [`**${esc(names)}**`, details || null, status ? `FACEIT: ${String(status).toLowerCase().replace(/_/g, ' ')}` : null].filter(Boolean).join('\n'),
    fields: teams.map((team, index) => ({
      name: `${marker(index)} ${team.label}${teamAvg ? ` · avg ${teamAvg[index]}` : ''}${expected ? ` · ${Math.round(expected[index] * 100)}% to win` : ''}`.slice(0, 256),
      value: roster(team, false).slice(0, 1024),
      inline: false
    })),
    color: 0xff5500
  };
}

// ---------- pinned messages ----------

export const BOARD_HEADING = '## 🎮 Arena: live games';
export const QUEUE_HEADING = '## ⏳ Arena queue';
export const LEADERBOARD_HEADING = '## 🏆 Arena season leaderboard';

// The pinned live games board (plain text): every match drafting or live.
//   games: [{ number, stage: 'drafting' | 'live', teams: [{ label }], map, score, cardUrl, url }]
export function liveBoardText({ games = [], updatedAt = new Date() }) {
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
  lines.push(`-# Updated <t:${Math.floor(new Date(updatedAt).getTime() / 1000)}:R>`);
  return lines.join('\n').slice(0, 2000);
}

// The pinned queue status (plain text). FACEIT's API does not say who is waiting in the hub
// queue, so this lists who is in the Queue voice channel.
export function queueText({ queue = [], queueChannelId = null, source = 'voice', updatedAt = new Date() }) {
  const where = queueChannelId ? `<#${queueChannelId}>` : 'the Queue voice channel';
  return [
    QUEUE_HEADING,
    queue.length
      ? `**In ${where} (${queue.length}):** ${queue.slice(0, 30).map((id) => `<@${id}>`).join(' ')}${queue.length > 30 ? ` +${queue.length - 30} more` : ''}`
      : `Nobody is in ${where} right now.`,
    source === 'voice' ? '-# FACEIT does not share who is in its queue, so this shows the Queue voice channel.' : null,
    `-# Updated <t:${Math.floor(new Date(updatedAt).getTime() / 1000)}:R>`
  ].filter(Boolean).join('\n').slice(0, 2000);
}

// The pinned season leaderboard (plain text): the FACEIT hub's standings, each row with the
// player's CF rating and rank. Placement and banned players are left out.
//   items: FACEIT leaderboard rows   ranks: { [playerId]: { label, placing } }   ratings: { [playerId]: rating }
export function leaderboardText({ name, items = [], ranks = {}, ratings = {}, banned = new Set(), running = true, url = null, limit = 25, updatedAt = new Date() }) {
  const shown = items.filter((row) => {
    const id = row.player?.user_id;
    return id && !banned.has(id) && ranks[id] && !ranks[id].placing;
  }).slice(0, limit);
  const rows = shown.map((row, index) => {
    const id = row.player.user_id;
    return `**#${index + 1}**  ${esc(row.player.nickname || '?')}  ${ranks[id].label} · ${ratings[id]}  (${row.won}–${row.lost})`;
  });
  const build = (list) => [
    `${LEADERBOARD_HEADING} · ${name}${running ? '' : ' (final)'}`,
    ...(list.length ? list : ['Nobody is ranked this season yet.']),
    '',
    url ? `**Full standings:** <${url}>` : null,
    `-# Season standings from FACEIT; CF rating and rank are permanent. Updated <t:${Math.floor(new Date(updatedAt).getTime() / 1000)}:R>`
  ].filter((line) => line !== null).join('\n');
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
        entry.withStats ? `K/D ${entry.kd.toFixed(2)} · ADR ${Math.round(entry.adr)}` : null,
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
    game.adr ? `ADR ${Math.round(game.adr)}` : null,
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
