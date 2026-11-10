// Caster prep pack: everything a caster wants to know before a match, built from FACEIT's season
// matches, their per-map stats, the Team Info tab and the veto. Pure functions; index.js fetches.

import { prettyMapName } from './matchResult.js';
import { isSocialColumn } from './socialInfo.js';

// ---------- team names (Team Info tab -> FACEIT) ----------

const NAME_NOISE = /\b(e-?sports?|gaming|team|club|gg|cs2?|org)\b/g;

export function teamKey(name) {
  return String(name || '').toLowerCase().replace(NAME_NOISE, ' ').replace(/[^a-z0-9]+/g, '');
}

// The Team Info row for a FACEIT team name: same name, or one name starting with the other
// ("Celestial" -> "Celestial Esports"). Longest match wins.
export function findTeamInfo(teams, name) {
  const key = teamKey(name);
  if (!key) return null;
  let best = null;
  for (const team of teams || []) {
    const other = team.key || teamKey(team.name);
    if (!other) continue;
    const score = other === key ? 1000 : (other.length >= 4 && key.length >= 4 && (key.startsWith(other) || other.startsWith(key))) ? Math.min(other.length, key.length) : 0;
    if (score && (!best || score > best.score)) best = { team, score };
  }
  return best?.team || null;
}

// Team Info tab rows ([[{ text, link }]]) -> [{ name, key, links: { hltv, liquipedia, ... }, pronunciation, notes, extra }].
export function parseTeamInfoRows(rows) {
  const [header = [], ...body] = rows || [];
  const headers = header.map((cell) => String(cell?.text || '').trim());
  const lower = headers.map((text) => text.toLowerCase());
  let nameColumn = lower.findIndex((text) => text === 'name' || text === 'team' || text === 'team name');
  if (nameColumn < 0) nameColumn = 0;
  const teams = [];
  for (const row of body) {
    const name = String(row?.[nameColumn]?.text || '').trim();
    if (!name) continue;
    const team = { name, key: teamKey(name), links: {}, pronunciation: '', notes: '', extra: {} };
    headers.forEach((label, column) => {
      if (column === nameColumn || !label) return;
      const cell = row?.[column] || {};
      const text = String(cell.text || '').trim();
      const key = label.toLowerCase();
      const link = cell.link || (/^https?:\/\//i.test(text) ? text : null);
      if (link) team.links[key] = link;
      else if (/pronunc/.test(key)) team.pronunciation = text;
      else if (/note|blurb|info/.test(key)) team.notes = text;
      else if (text) team.extra[label] = text;
    });
    teams.push(team);
  }
  return teams;
}

// ---------- FACEIT data ----------

// The /matches/{id}/stats payload, kept small: per map the score and every player's numbers.
export function compactMatchStats(stats) {
  return {
    maps: (stats?.rounds || []).map((round) => ({
      map: prettyMapName(round?.round_stats?.Map),
      rounds: Number(round?.round_stats?.Rounds) || null,
      winnerId: round?.round_stats?.Winner || null,
      teams: (round?.teams || []).map((team) => ({
        teamId: team.team_id || null,
        name: team.team_stats?.Team || '',
        score: Number(team.team_stats?.['Final Score']),
        players: (team.players || []).map((player) => ({
          playerId: player.player_id,
          nickname: player.nickname,
          kills: Number(player.player_stats?.Kills) || 0,
          deaths: Number(player.player_stats?.Deaths) || 0,
          adr: Number(player.player_stats?.ADR) || 0,
          hsPercent: Number(player.player_stats?.['Headshots %']) || 0
        }))
      }))
    })).filter((map) => map.teams.length === 2)
  };
}

function factions(match) {
  const teams = match?.raw?.teams || {};
  return [
    { side: 'faction1', ...(teams.faction1 || {}), name: match?.teamA },
    { side: 'faction2', ...(teams.faction2 || {}), name: match?.teamB }
  ];
}

function sameTeam(faction, team) {
  if (team.id && faction.faction_id) return faction.faction_id === team.id;
  return teamKey(faction.name) === teamKey(team.name);
}

export function matchTimeMs(match) {
  const raw = match?.raw || {};
  for (const value of [raw.finished_at, raw.started_at, raw.scheduled_at]) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  }
  const parsed = Date.parse(match?.scheduledAt || '');
  return Number.isFinite(parsed) ? parsed : null;
}

const isFinished = (match) => /finished/i.test(String(match?.status || ''));

// The team's view of one finished match: won?, series score, opponent, map scores (team first).
function teamResult(match, team, statsById) {
  const [own, other] = (() => {
    const [a, b] = factions(match);
    return sameTeam(a, team) ? [a, b] : [b, a];
  })();
  const winner = match.raw?.results?.winner;
  const score = match.raw?.results?.score || {};
  const stats = statsById?.get?.(match.id) || null;
  const maps = (stats?.maps || []).map((map) => {
    const mine = map.teams.find((entry) => (own.faction_id && entry.teamId === own.faction_id) || teamKey(entry.name) === teamKey(own.name));
    const theirs = map.teams.find((entry) => entry !== mine);
    return mine && theirs ? { map: map.map, for: mine.score, against: theirs.score, players: mine.players, rounds: map.rounds } : null;
  }).filter(Boolean);
  const ownScore = Number(score[own.side]);
  const otherScore = Number(score[other.side]);
  const mapsWon = maps.filter((map) => map.for > map.against).length;
  const mapsLost = maps.filter((map) => map.for < map.against).length;
  const won = winner ? winner === own.side : (Number.isFinite(ownScore) && Number.isFinite(otherScore) ? ownScore > otherScore : mapsWon > mapsLost);
  return {
    matchId: match.id,
    url: match.faceitUrl || null,
    timeMs: matchTimeMs(match),
    opponent: other.name,
    opponentId: other.faction_id || null,
    won,
    series: Number.isFinite(ownScore) && Number.isFinite(otherScore) ? `${ownScore}-${otherScore}` : `${mapsWon}-${mapsLost}`,
    maps,
    roster: (own.roster || []).map((player) => player.player_id)
  };
}

// A team's season so far (finished matches only, oldest first).
export function teamSeason(team, seasonMatches, statsById, { excludeMatchId = null } = {}) {
  const results = (seasonMatches || [])
    .filter((match) => match.id !== excludeMatchId && isFinished(match) && factions(match).some((faction) => sameTeam(faction, team)))
    .map((match) => teamResult(match, team, statsById))
    .sort((a, b) => (a.timeMs || 0) - (b.timeMs || 0));
  const wins = results.filter((result) => result.won).length;
  const mapRecord = { won: 0, lost: 0 };
  const rounds = { won: 0, lost: 0 };
  const mapPool = new Map();
  const players = new Map();
  const mapPlayers = new Map();
  let overtimes = 0;
  let closest = null;
  for (const result of results) {
    for (const map of result.maps) {
      const won = map.for > map.against;
      if (Number.isFinite(map.for) && Number.isFinite(map.against)) {
        rounds.won += map.for;
        rounds.lost += map.against;
      }
      if (won) mapRecord.won += 1;
      else mapRecord.lost += 1;
      const entry = mapPool.get(map.map) || { map: map.map, won: 0, lost: 0 };
      if (won) entry.won += 1;
      else entry.lost += 1;
      mapPool.set(map.map, entry);
      if (Math.max(map.for, map.against) > 13) overtimes += 1;
      const diff = Math.abs(map.for - map.against);
      if (!closest || diff < closest.diff) closest = { diff, map: map.map, score: `${map.for}-${map.against}`, opponent: result.opponent };
      for (const player of map.players || []) {
        const stats = players.get(player.playerId) || { playerId: player.playerId, nickname: player.nickname, maps: 0, kills: 0, deaths: 0, adrTotal: 0, hsKills: 0 };
        stats.nickname = player.nickname || stats.nickname;
        stats.maps += 1;
        stats.kills += player.kills;
        stats.deaths += player.deaths;
        stats.adrTotal += player.adr;
        stats.hsKills += (player.kills * player.hsPercent) / 100;
        players.set(player.playerId, stats);
        const onMap = mapPlayers.get(map.map) || new Map();
        const mapStats = onMap.get(player.playerId) || { playerId: player.playerId, nickname: player.nickname, maps: 0, kills: 0, deaths: 0, adrTotal: 0 };
        mapStats.nickname = player.nickname || mapStats.nickname;
        mapStats.maps += 1;
        mapStats.kills += player.kills;
        mapStats.deaths += player.deaths;
        mapStats.adrTotal += player.adr;
        onMap.set(player.playerId, mapStats);
        mapPlayers.set(map.map, onMap);
      }
    }
  }
  let streak = null;
  for (let index = results.length - 1; index >= 0; index -= 1) {
    if (!streak) streak = { won: results[index].won, count: 1 };
    else if (results[index].won === streak.won) streak.count += 1;
    else break;
  }
  const playerList = [...players.values()].map((player) => ({
    ...player,
    kd: player.deaths ? player.kills / player.deaths : player.kills,
    adr: player.maps ? player.adrTotal / player.maps : 0,
    hs: player.kills ? (player.hsKills / player.kills) * 100 : 0
  })).sort((a, b) => b.kd - a.kd);
  return {
    results,
    wins,
    losses: results.length - wins,
    mapRecord,
    rounds,
    streak,
    mapPool: [...mapPool.values()].sort((a, b) => (b.won + b.lost) - (a.won + a.lost) || b.won - a.won),
    players: playerList,
    mapPlayers,
    overtimes,
    closest,
    rosterSeen: new Set(results.flatMap((result) => result.roster))
  };
}

// Group table for one group: [{ name, id, wins, losses, mapDiff }] best first.
export function groupStandings(group, seasonMatches, statsById) {
  if (!group) return [];
  const table = new Map();
  for (const match of seasonMatches || []) {
    if (match.group !== group || !isFinished(match)) continue;
    for (const faction of factions(match)) {
      const team = { id: faction.faction_id || null, name: faction.name };
      const key = team.id || teamKey(team.name);
      const row = table.get(key) || { ...team, wins: 0, losses: 0, mapDiff: 0 };
      const result = teamResult(match, team, statsById);
      if (result.won) row.wins += 1;
      else row.losses += 1;
      const [mapsFor, mapsAgainst] = result.series.split('-').map(Number);
      if (Number.isFinite(mapsFor) && Number.isFinite(mapsAgainst)) row.mapDiff += mapsFor - mapsAgainst;
      table.set(key, row);
    }
  }
  return [...table.values()].sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.mapDiff - a.mapDiff || a.name.localeCompare(b.name));
}

function ordinal(n) {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]}`;
}

export function whatsAtStake(match) {
  const round = String(match?.round || '');
  if (/grand\s*final/i.test(round)) return 'Grand Final: the winner takes the title.';
  if (/lower/i.test(round) && /upper/i.test(round)) return 'Bracket match: an upper-bracket loss drops a team to the lower bracket; a lower-bracket loss ends their season.';
  if (/lower/i.test(round)) return 'Lower bracket: the loser is eliminated.';
  if (/upper/i.test(round)) return 'Upper bracket: the winner stays in the upper bracket; the loser drops to the lower bracket.';
  if (match?.group) return `Group ${String(match.group).replace(/^Group\s+/i, '')}: standings on the line.`;
  return null;
}

// FACEIT's veto history for a match -> { actions: [{ map, action: 'ban' | 'pick' | 'decider',
// teamId, teamName, random }] } in veto order. The last map left over is the decider (nobody picks
// it). Returns { actions: [] } when FACEIT has no map veto for the match.
export function compactFaceitVeto(payload, match) {
  const ticket = (payload?.tickets || []).find((entry) => entry?.entity_type === 'map');
  const entities = [...(ticket?.entities || [])].sort((x, y) => Number(x.round) - Number(y.round));
  const lastRound = Math.max(0, ...entities.map((entity) => Number(entity.round) || 0));
  const sides = Object.fromEntries(factions(match).map((faction) => [faction.side, faction]));
  return {
    actions: entities
      .filter((entity) => entity?.guid && ['drop', 'pick'].includes(entity.status))
      .map((entity) => {
        const decider = entity.status === 'pick' && Number(entity.round) === lastRound && entities.length > 1;
        const side = decider ? null : sides[entity.selected_by] || null;
        return {
          map: entity.guid,
          action: decider ? 'decider' : entity.status === 'drop' ? 'ban' : 'pick',
          teamId: side?.faction_id || null,
          teamName: side?.name || null,
          random: Boolean(entity.random)
        };
      })
  };
}

// The bot's own (playoff) veto in the same shape, for ban rates.
export function compactBotVeto(veto) {
  if (veto?.status !== 'complete') return null;
  const name = (side) => (side === 'teamA' ? veto.teamA : veto.teamB);
  return {
    actions: [
      ...(veto.actions || []).map((entry) => ({ map: entry.map, action: entry.action === 'pick' ? 'pick' : 'ban', teamId: null, teamName: name(entry.team), random: false })),
      ...(veto.final?.decider ? [{ map: veto.final.decider, action: 'decider', teamId: null, teamName: null, random: false }] : [])
    ]
  };
}

function actionByTeam(action, team) {
  if (team.id && action.teamId) return action.teamId === team.id;
  return Boolean(action.teamName) && teamKey(action.teamName) === teamKey(team.name);
}

// How often a team banned each map this season, over the finished matches we have a veto for:
// { vetoes, bans: [{ map, count }] (most banned first), firstBans: [{ map, count }] }.
export function teamBanRates(team, seasonMatches, vetoById, { excludeMatchId = null } = {}) {
  const bans = new Map();
  const firstBans = new Map();
  let vetoes = 0;
  for (const match of seasonMatches || []) {
    if (match.id === excludeMatchId || !isFinished(match) || !factions(match).some((faction) => sameTeam(faction, team))) continue;
    const mine = (vetoById?.get?.(match.id)?.actions || []).filter((action) => action.action === 'ban' && actionByTeam(action, team));
    if (!mine.length) continue;
    vetoes += 1;
    for (const map of new Set(mine.map((action) => prettyMapName(action.map)))) bans.set(map, (bans.get(map) || 0) + 1);
    const first = prettyMapName(mine[0].map);
    firstBans.set(first, (firstBans.get(first) || 0) + 1);
  }
  const ranked = (counts) => [...counts].map(([map, count]) => ({ map, count })).sort((x, y) => y.count - x.count || x.map.localeCompare(y.map));
  return { vetoes, bans: ranked(bans), firstBans: ranked(firstBans) };
}

// The team's most common first ban; ties are all listed ("Dust2 / Mirage (1 of 2 each)").
function firstBanLine(rates) {
  const top = rates.firstBans.filter((entry) => entry.count === rates.firstBans[0]?.count);
  if (!top.length) return null;
  return `First ban: ${top.map((entry) => entry.map).join(' / ')} (${top[0].count} of ${rates.vetoes}${top.length > 1 ? ' each' : ''})`;
}

function banRateField(rates) {
  if (!rates?.vetoes) return null;
  const pct = (count) => `${Math.round((count / rates.vetoes) * 100)}%`;
  const lines = [
    rates.bans.map((entry) => `${entry.map} **${pct(entry.count)}** (${entry.count}/${rates.vetoes})`).join(' · '),
    firstBanLine(rates)
  ].filter(Boolean);
  return { name: `🚫 Ban rate (${rates.vetoes} veto${rates.vetoes === 1 ? '' : 'es'})`, value: lines.join('\n').slice(0, 1024) };
}

// Map list from the bot's veto (playoffs) or FACEIT's vote (group stage). `faceitVeto` (from
// compactFaceitVeto) adds who picked each map and the bans.
export function vetoSummary({ veto = null, match = null, faceitVeto = null } = {}) {
  if (veto?.status === 'complete' && veto.final) {
    const teamName = (side) => (side === 'teamA' ? veto.teamA : veto.teamB);
    const picks = veto.actions.filter((action) => action.action === 'pick');
    const maps = picks.map((action) => ({ map: action.map, note: `${teamName(action.team)} pick` }));
    if (veto.final.decider) maps.push({ map: veto.final.decider, note: 'decider' });
    if (veto.final.awardedMap) maps.unshift({ map: veto.final.awardedMap, note: `awarded to ${veto.final.startingScore?.replace(/^1-0\s*/, '') || 'upper bracket team'}` });
    const bans = veto.actions.filter((action) => action.action === 'ban').map((action) => `${prettyMapName(action.map)} (${teamName(action.team)})`);
    const order = [
      ...(veto.final.awardedMap ? [{ kind: 'awarded', map: veto.final.awardedMap, team: veto.final.startingScore?.replace(/^1-0\s*/, '') || 'upper bracket team' }] : []),
      ...veto.actions.map((action) => ({ kind: action.action === 'pick' ? 'pick' : 'ban', map: action.map, team: teamName(action.team) })),
      ...(veto.final.decider ? [{ kind: 'decider', map: veto.final.decider }] : [])
    ];
    return { state: 'done', maps: maps.map((entry) => ({ ...entry, map: prettyMapName(entry.map) })), bans, order: numberOrder(order) };
  }
  if (veto && ['active', 'choosing_first_action'].includes(veto.status)) {
    const teamName = (side) => (side === 'teamA' ? veto.teamA : veto.teamB);
    const progress = (veto.actions || []).map((action) => `${action.action === 'pick' ? 'Pick' : 'Ban'}: ${prettyMapName(action.map)} (${teamName(action.team)})`);
    return { state: 'in progress', maps: [], bans: [], progress };
  }
  // FACEIT's picks only count once its veto is over (CONFIGURING, READY, ONGOING, ...); while
  // the room is still voting, a half-finished pick list would read as the final maps.
  const status = faceitStatus(match);
  if (FACEIT_VETO_RUNNING.has(status)) return { state: 'in progress', maps: [], bans: [], progress: [], faceitVeto: true };
  const picked = FACEIT_PRE_VETO.has(status) ? [] : match?.raw?.voting?.map?.pick || [];
  if (picked.length) {
    const actions = faceitVeto?.actions || [];
    const chosen = actions.filter((action) => action.action !== 'ban');
    // Only trust the veto history when it agrees with FACEIT's final maps.
    if (chosen.length === picked.length && chosen.every((action, index) => action.map === picked[index])) {
      const note = (action) => (action.action === 'decider' ? 'decider' : `${action.teamName || 'team'} pick${action.random ? ' (random)' : ''}`);
      return {
        state: 'done',
        maps: chosen.map((action) => ({ map: prettyMapName(action.map), note: note(action) })),
        bans: actions.filter((action) => action.action === 'ban').map((action) => `${prettyMapName(action.map)} (${action.teamName || 'team'}${action.random ? ', random' : ''})`),
        order: numberOrder(actions.map((action) => ({ kind: action.action, map: action.map, team: action.teamName || 'team', random: action.random })))
      };
    }
    return { state: 'done', maps: picked.map((map) => ({ map: prettyMapName(map), note: null })), bans: [] };
  }
  return { state: 'not yet', maps: [], bans: [] };
}

// Veto steps in the order they happened, each played map numbered (Map 1, Map 2, ...).
function numberOrder(steps) {
  let mapNumber = 0;
  return steps.map((step) => ({ ...step, map: prettyMapName(step.map), mapNumber: step.kind === 'ban' ? null : (mapNumber += 1) }));
}

// The whole veto, one line per step:
//   Anubis · O Fire ban
//   **Mirage** · O Fire pick → Map 1
//   **Dust2** · decider (left over) → Map 3
export function vetoOrderLines(vetoInfo) {
  return (vetoInfo?.order || []).map((step) => {
    const random = step.random ? ' (random)' : '';
    if (step.kind === 'ban') return `${step.map} · ${step.team} ban${random}`;
    if (step.kind === 'pick') return `**${step.map}** · ${step.team} pick${random} → Map ${step.mapNumber}`;
    if (step.kind === 'awarded') return `**${step.map}** · awarded to ${step.team} → Map ${step.mapNumber}`;
    return `**${step.map}** · decider (left over) → Map ${step.mapNumber}`;
  });
}

const FACEIT_PRE_VETO = new Set(['SCHEDULED', 'CHECK_IN']);
const FACEIT_VETO_RUNNING = new Set(['VOTING']);

function faceitStatus(match) {
  return String(match?.raw?.status || match?.status || '').toUpperCase();
}

// The FACEIT room has gone live but its maps are not locked yet: worth checking more often.
export function faceitVetoUnderway(match) {
  return FACEIT_VETO_RUNNING.has(faceitStatus(match));
}

// What changes the pack: the two lineups and the maps.
export function prepSignature(match, vetoInfo) {
  const rosters = factions(match).map((faction) => (faction.roster || []).map((player) => player.player_id).sort().join(','));
  return `${rosters.join('|')}#${(vetoInfo?.maps || []).map((entry) => entry.map).join(',')}#${(vetoInfo?.progress || []).length}${vetoInfo?.faceitVeto ? 'f' : ''}`;
}

function teamTalkingPoints(name, season, rosterNow) {
  const points = [];
  if (season.results.length && season.losses === 0) points.push(`${name} is unbeaten this season (${season.wins}-0).`);
  if (season.results.length >= 2 && season.wins === 0) points.push(`${name} is still looking for a first win (0-${season.losses}).`);
  if (season.streak && season.streak.count >= 3) points.push(`${name} has ${season.streak.won ? 'won' : 'lost'} ${season.streak.count} in a row.`);
  const best = season.mapPool.find((map) => map.won >= 2 && map.lost === 0);
  if (best) points.push(`${name} has never lost on ${best.map} (${best.won}-0).`);
  const worst = season.mapPool.find((map) => map.lost >= 2 && map.won === 0);
  if (worst) points.push(`${name} is 0-${worst.lost} on ${worst.map}.`);
  const star = season.players.find((player) => player.maps >= 2 && rosterNow.has(player.playerId));
  if (star && star.kd >= 1.25) points.push(`${star.nickname} is averaging a ${star.kd.toFixed(2)} K/D for ${name}.`);
  return points;
}

function rosterLine(faction, season) {
  const roster = faction.roster || [];
  if (!roster.length) return 'Not posted yet.';
  const hasHistory = season.results.length > 0;
  return roster.map((player) => {
    const captain = player.player_id && player.player_id === faction.leader ? ' (C)' : '';
    const standIn = hasHistory && !season.rosterSeen.has(player.player_id) ? ' · stand-in' : '';
    return `${player.nickname}${captain}${standIn}`;
  }).join('\n');
}

function shortDate(ms) {
  return ms ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(new Date(ms)) : '';
}

// "[text](url)" when there is a link, plain text otherwise.
function linked(text, url) {
  return url ? `[${text}](${url})` : text;
}

function linkLabel(header) {
  const lower = String(header || '').toLowerCase();
  if (lower === 'hltv') return 'HLTV';
  if (lower === 'liquipedia') return 'Liquipedia';
  return String(header || '').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function linkOrder(header) {
  const order = ['hltv', 'liquipedia'];
  const index = order.indexOf(String(header || '').toLowerCase());
  return index < 0 ? order.length : index;
}

// "Celestial 4-1 · last: W 13-7 vs X · best: Zeph 1.52 K/D, 104 ADR here" (or "first time on this map").
function teamOnMapLine(name, season, mapName, rosterNow) {
  const record = season.mapPool.find((map) => map.map === mapName);
  if (!record) return `**${name}**: first time on ${mapName} this season`;
  const last = [...season.results].reverse().find((result) => result.maps.some((map) => map.map === mapName));
  const lastMap = last?.maps.find((map) => map.map === mapName);
  const lastText = lastMap ? ` · last: ${linked(`${lastMap.for > lastMap.against ? 'W' : 'L'} ${lastMap.for}-${lastMap.against} vs ${last.opponent}`, last.url)}` : '';
  const best = [...(season.mapPlayers?.get(mapName)?.values() || [])]
    .filter((player) => !rosterNow?.size || rosterNow.has(player.playerId))
    .map((player) => ({ ...player, kd: player.deaths ? player.kills / player.deaths : player.kills, adr: player.maps ? player.adrTotal / player.maps : 0 }))
    .sort((a, b) => b.kd - a.kd)[0];
  const bestText = best ? ` · best: ${best.nickname} ${best.kd.toFixed(2)} K/D, ${Math.round(best.adr)} ADR here` : '';
  return `**${name}** ${record.won}-${record.lost}${lastText}${bestText}`;
}

function mapLine(map) {
  return `${map.map} ${map.for}-${map.against}`;
}

// The team card.
function teamCard(faction, season, info, standing, seasonName = 'Season', banRates = null) {
  const fields = [];
  fields.push({ name: '👥 Roster', value: rosterLine(faction, season).slice(0, 1024), inline: true });
  const record = season.results.length
    ? [
      `Matches **${season.wins}-${season.losses}** · Maps **${season.mapRecord.won}-${season.mapRecord.lost}**`,
      season.streak ? `Streak: ${season.streak.won ? 'W' : 'L'}${season.streak.count}` : null,
      standing || null,
      season.rounds && (season.rounds.won || season.rounds.lost) ? `Round diff: **${season.rounds.won - season.rounds.lost > 0 ? '+' : ''}${season.rounds.won - season.rounds.lost}** (${season.rounds.won} won, ${season.rounds.lost} lost)` : null,
      season.overtimes ? `Overtimes: ${season.overtimes}` : null,
      season.closest ? `Closest map: ${season.closest.score} on ${season.closest.map} vs ${season.closest.opponent}` : null
    ].filter(Boolean).join('\n')
    : ['First match of the season.', standing].filter(Boolean).join('\n');
  fields.push({ name: '📊 Record', value: record.slice(0, 1024), inline: true });
  if (season.results.length) {
    const shown = season.results.slice(-8).reverse();
    const more = season.results.length - shown.length;
    fields.push({
      name: `📅 ${seasonName}`,
      value: (shown.map((result) => `${result.won ? '**W**' : '**L**'} ${linked(`${result.series} vs ${result.opponent}`, result.url)} · ${shortDate(result.timeMs)}${result.maps.length ? `\n  ${result.maps.map(mapLine).join(', ')}` : ''}`).join('\n') + (more > 0 ? `\n…and ${more} earlier` : '')).slice(0, 1024)
    });
  }
  if (season.mapPool.length) {
    fields.push({ name: '🗺️ Map pool', value: season.mapPool.map((map) => `${map.map} ${map.won}-${map.lost}`).join(' · ').slice(0, 1024) });
  }
  const banField = banRateField(banRates);
  if (banField) fields.push(banField);
  const rosterNow = new Set((faction.roster || []).map((player) => player.player_id));
  const top = season.players.filter((player) => player.maps >= 1 && (!rosterNow.size || rosterNow.has(player.playerId))).slice(0, 3);
  if (top.length) {
    fields.push({
      name: '⭐ Top players',
      value: top.map((player) => `${player.nickname}: ${player.kills} K · ${player.deaths} D · ${player.kd.toFixed(2)} K/D · ${Math.round(player.adr)} ADR · ${Math.round(player.hs)}% HS (${player.maps} map${player.maps === 1 ? '' : 's'})`).join('\n').slice(0, 1024)
    });
  }
  const links = [
    faction.faction_id ? `[FACEIT](https://www.faceit.com/en/teams/${faction.faction_id})` : null,
    ...Object.entries(info?.links || {})
      .filter(([label]) => !isSocialColumn(label))
      .sort(([a], [b]) => linkOrder(a) - linkOrder(b))
      .map(([label, url]) => `[${linkLabel(label)}](${url})`)
  ].filter(Boolean);
  return { title: `🛡️ ${faction.name}`, description: links.length ? links.join(' · ') : null, fields };
}

// A team's notes from the Team Info tab, posted as their own reply. null when there are none.
export function teamNotesCard(name, info) {
  const lines = [
    info?.pronunciation ? `Say it: **${info.pronunciation}**` : null,
    info?.notes || null,
    ...Object.entries(info?.extra || {}).filter(([label]) => !isSocialColumn(label)).map(([label, value]) => `**${label}:** ${value}`)
  ].filter(Boolean);
  return lines.length ? { title: `📝 ${name} notes`, description: lines.join('\n').slice(0, 4000), fields: [] } : null;
}

// Builds the whole pack. Returns { embeds, signature, talkingPoints }.
export function buildPrepPack({
  match,
  seasonMatches = [],
  statsById = new Map(),
  vetoById = new Map(),
  teamInfo = [],
  veto = null,
  faceitVeto = null,
  streamHistory = [],
  startIso = null,
  streamUrl = null,
  matchChannelId = null,
  seasonName = 'Season',
  now = Date.now()
}) {
  const [a, b] = factions(match);
  const teamA = { id: a.faction_id || null, name: a.name };
  const teamB = { id: b.faction_id || null, name: b.name };
  const seasonA = teamSeason(teamA, seasonMatches, statsById, { excludeMatchId: match.id });
  const seasonB = teamSeason(teamB, seasonMatches, statsById, { excludeMatchId: match.id });
  const standings = groupStandings(match.group, seasonMatches, statsById);
  const standingFor = (team) => {
    const index = standings.findIndex((row) => (team.id && row.id === team.id) || teamKey(row.name) === teamKey(team.name));
    return index >= 0 ? `${ordinal(index + 1)} in Group ${String(match.group).replace(/^Group\s+/i, '')} (${standings[index].wins}-${standings[index].losses})` : null;
  };
  const vetoInfo = vetoSummary({ veto, match, faceitVeto });
  const h2h = seasonA.results.filter((result) => (teamB.id && result.opponentId === teamB.id) || teamKey(result.opponent) === teamKey(teamB.name));

  const rosterA = new Set((a.roster || []).map((player) => player.player_id));
  const rosterB = new Set((b.roster || []).map((player) => player.player_id));
  const talkingPoints = [
    h2h.length ? `Rematch: ${h2h[h2h.length - 1].won ? teamA.name : teamB.name} won their last meeting ${h2h[h2h.length - 1].won ? h2h[h2h.length - 1].series : h2h[h2h.length - 1].series.split('-').reverse().join('-')}.` : 'First meeting this season.',
    ...teamTalkingPoints(teamA.name, seasonA, rosterA),
    ...teamTalkingPoints(teamB.name, seasonB, rosterB)
  ];
  for (const [faction, season] of [[a, seasonA], [b, seasonB]]) {
    const standIns = (faction.roster || []).filter((player) => season.results.length && !season.rosterSeen.has(player.player_id));
    if (standIns.length) talkingPoints.push(`${faction.name} has ${standIns.length === 1 ? 'a stand-in' : 'stand-ins'}: ${standIns.map((player) => player.nickname).join(', ')}.`);
  }

  const startMs = Date.parse(startIso || '') || matchTimeMs(match);
  const stamp = startMs ? `<t:${Math.floor(startMs / 1000)}:F> (<t:${Math.floor(startMs / 1000)}:R>)` : 'Time TBD';
  // One field per map: who picked it, each team's record and last result on it, their best player
  // on it (current lineup), and any head-to-head on it.
  const mapFields = vetoInfo.maps.map((entry, index) => {
    const lines = [
      teamOnMapLine(teamA.name, seasonA, entry.map, rosterA),
      teamOnMapLine(teamB.name, seasonB, entry.map, rosterB)
    ];
    const meetings = h2h.flatMap((result) => result.maps.filter((map) => map.map === entry.map).map((map) => ({ result, map })));
    if (meetings.length) {
      lines.push(`H2H here: ${meetings.map(({ result, map }) => linked(`${map.for > map.against ? teamA.name : teamB.name} won ${Math.max(map.for, map.against)}-${Math.min(map.for, map.against)}`, result.url)).join(', ')}`);
    }
    return { name: `📍 Map ${index + 1} · ${entry.map}${entry.note ? ` (${entry.note})` : ''}`, value: lines.join('\n').slice(0, 1024) };
  });
  // Just the picks and bans; the per-map breakdown goes in its own card at the end.
  const mapsValue = vetoInfo.order?.length
    ? vetoOrderLines(vetoInfo).join('\n')
    : vetoInfo.maps.length
    ? [
      ...vetoInfo.maps.map((entry, index) => `**${index + 1}. ${entry.map}**${entry.note ? ` · ${entry.note}` : ''}`),
      vetoInfo.bans.length ? `Bans: ${vetoInfo.bans.join(' · ')}` : null
    ].filter(Boolean).join('\n')
    : vetoInfo.state === 'in progress'
      ? (vetoInfo.faceitVeto
        ? 'Veto in progress on FACEIT…'
        : [...(vetoInfo.progress || []), (vetoInfo.progress || []).length ? 'Veto in progress…' : 'Veto starting…'].join('\n'))
      : 'Veto not done yet. This updates when it is.';
  const links = [
    match.faceitUrl ? `[FACEIT room](${match.faceitUrl})` : null,
    matchChannelId ? `<#${matchChannelId}>` : null,
    streamUrl ? `[Stream](${streamUrl})` : null
  ].filter(Boolean).join(' · ');
  const matchCard = {
    title: `🎙️ Prep · ${teamA.name} vs ${teamB.name}`,
    description: [stamp, [match.round, match.group ? `Group ${String(match.group).replace(/^Group\s+/i, '')}` : null].filter(Boolean).join(' · ') || null, links || null].filter(Boolean).join('\n'),
    fields: [
      whatsAtStake(match) ? { name: "🏆 What's at stake", value: whatsAtStake(match) } : null,
      { name: vetoInfo.maps.length ? '🗺️ Maps locked' : '🗺️ Maps', value: mapsValue.slice(0, 1024) },
      {
        name: '⚔️ H2H',
        value: h2h.length
          ? h2h.map((result) => `${linked(`${result.won ? teamA.name : teamB.name} won ${result.won ? result.series : result.series.split('-').reverse().join('-')}`, result.url)} · ${shortDate(result.timeMs)}${result.maps.length ? ` (${result.maps.map((map) => (result.won ? mapLine(map) : `${map.map} ${map.against}-${map.for}`)).join(', ')})` : ''}`).join('\n').slice(0, 1024)
          : 'First meeting this season.'
      },
      { name: '💬 Talking points', value: talkingPoints.map((point) => `• ${point}`).join('\n').slice(0, 1024) }
    ].filter(Boolean)
  };
  // Posted as its own reply once the maps are locked.
  const mapFactsCard = mapFields.length
    ? { title: '🗺️ Map facts', description: 'Each team\'s record, last result and best current player on tonight\'s maps.', fields: mapFields }
    : null;
  const infoA = findTeamInfo(teamInfo, a.name);
  const infoB = findTeamInfo(teamInfo, b.name);
  return {
    embeds: [
      matchCard,
      teamCard(a, seasonA, infoA, standingFor(teamA), seasonName, teamBanRates(teamA, seasonMatches, vetoById, { excludeMatchId: match.id })),
      teamCard(b, seasonB, infoB, standingFor(teamB), seasonName, teamBanRates(teamB, seasonMatches, vetoById, { excludeMatchId: match.id }))
    ],
    mapFacts: mapFactsCard,
    notes: [teamNotesCard(a.name, infoA), teamNotesCard(b.name, infoB)].filter(Boolean),
    // Facts for the Social Media team's card.
    social: {
      round: match.round || null,
      group: match.group || null,
      storylines: talkingPoints,
      stars: [[a, seasonA, rosterA], [b, seasonB, rosterB]]
        .map(([faction, season, roster]) => {
          const star = season.players.find((player) => !roster.size || roster.has(player.playerId));
          return star ? { team: faction.name, nickname: star.nickname, kd: star.kd, adr: star.adr } : null;
        })
        .filter(Boolean),
      maps: vetoInfo.maps.map((entry) => entry.map)
    },
    signature: prepSignature(match, vetoInfo),
    vetoState: vetoInfo.state,
    maps: vetoInfo.maps.map((entry) => entry.map),
    bans: vetoInfo.bans,
    vetoOrder: vetoOrderLines(vetoInfo),
    talkingPoints
  };
}
