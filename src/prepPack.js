// Caster prep pack: everything a caster wants to know before a match, built from FACEIT's season
// matches, their per-map stats, the Team Info tab and the veto. Pure functions; index.js fetches.

import { prettyMapName } from './matchResult.js';

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
  const mapPool = new Map();
  const players = new Map();
  let overtimes = 0;
  let closest = null;
  for (const result of results) {
    for (const map of result.maps) {
      const won = map.for > map.against;
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
    streak,
    mapPool: [...mapPool.values()].sort((a, b) => (b.won + b.lost) - (a.won + a.lost) || b.won - a.won),
    players: playerList,
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

// Map list from the bot's veto (playoffs) or FACEIT's vote (group stage).
export function vetoSummary({ veto = null, match = null } = {}) {
  if (veto?.status === 'complete' && veto.final) {
    const teamName = (side) => (side === 'teamA' ? veto.teamA : veto.teamB);
    const picks = veto.actions.filter((action) => action.action === 'pick');
    const maps = picks.map((action) => ({ map: action.map, note: `${teamName(action.team)} pick` }));
    if (veto.final.decider) maps.push({ map: veto.final.decider, note: 'decider' });
    if (veto.final.awardedMap) maps.unshift({ map: veto.final.awardedMap, note: `awarded to ${veto.final.startingScore?.replace(/^1-0\s*/, '') || 'upper bracket team'}` });
    const bans = veto.actions.filter((action) => action.action === 'ban').map((action) => `${prettyMapName(action.map)} (${teamName(action.team)})`);
    return { state: 'done', maps: maps.map((entry) => ({ ...entry, map: prettyMapName(entry.map) })), bans };
  }
  if (veto && ['active', 'choosing_first_action'].includes(veto.status)) return { state: 'in progress', maps: [], bans: [] };
  const picked = match?.raw?.voting?.map?.pick || [];
  if (picked.length) return { state: 'done', maps: picked.map((map) => ({ map: prettyMapName(map), note: null })), bans: [] };
  return { state: 'not yet', maps: [], bans: [] };
}

// What changes the pack: the two lineups and the maps.
export function prepSignature(match, vetoInfo) {
  const rosters = factions(match).map((faction) => (faction.roster || []).map((player) => player.player_id).sort().join(','));
  return `${rosters.join('|')}#${(vetoInfo?.maps || []).map((entry) => entry.map).join(',')}`;
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
    const captain = player.player_id && player.player_id === faction.leader ? '👑 ' : '';
    const level = player.game_skill_level ? ` (lvl ${player.game_skill_level})` : '';
    const standIn = hasHistory && !season.rosterSeen.has(player.player_id) ? ' · stand-in' : '';
    return `${captain}${player.nickname}${level}${standIn}`;
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

function mapLine(map) {
  return `${map.map} ${map.for}-${map.against}`;
}

// The team card.
function teamCard(faction, season, info, standing, lastOnStream) {
  const fields = [];
  fields.push({ name: 'Roster', value: rosterLine(faction, season).slice(0, 1024), inline: true });
  const record = season.results.length
    ? [
      `Matches **${season.wins}-${season.losses}** · Maps **${season.mapRecord.won}-${season.mapRecord.lost}**`,
      season.streak ? `Streak: ${season.streak.won ? 'W' : 'L'}${season.streak.count}` : null,
      standing || null,
      season.overtimes ? `Overtimes: ${season.overtimes}` : null,
      season.closest ? `Closest map: ${season.closest.score} on ${season.closest.map} vs ${season.closest.opponent}` : null
    ].filter(Boolean).join('\n')
    : ['First match of the season.', standing].filter(Boolean).join('\n');
  fields.push({ name: 'Season', value: record.slice(0, 1024), inline: true });
  if (season.results.length) {
    fields.push({
      name: 'Last 3',
      value: season.results.slice(-3).reverse().map((result) => `${result.won ? '✅' : '❌'} ${linked(`${result.series} vs ${result.opponent}`, result.url)} · ${shortDate(result.timeMs)}${result.maps.length ? `\n  ${result.maps.map(mapLine).join(', ')}` : ''}`).join('\n').slice(0, 1024)
    });
  }
  if (season.mapPool.length) {
    fields.push({ name: 'Map pool (most played first)', value: season.mapPool.map((map) => `${map.map} ${map.won}-${map.lost}`).join(' · ').slice(0, 1024) });
  }
  const rosterNow = new Set((faction.roster || []).map((player) => player.player_id));
  const top = season.players.filter((player) => player.maps >= 1 && (!rosterNow.size || rosterNow.has(player.playerId))).slice(0, 3);
  if (top.length) {
    fields.push({
      name: 'Top players',
      value: top.map((player, index) => `${index === 0 ? '⭐ ' : ''}${player.nickname}: ${player.kd.toFixed(2)} K/D · ${Math.round(player.adr)} ADR · ${Math.round(player.hs)}% HS (${player.maps} map${player.maps === 1 ? '' : 's'})`).join('\n').slice(0, 1024)
    });
  }
  const links = [
    faction.faction_id ? `[FACEIT](https://www.faceit.com/en/teams/${faction.faction_id})` : null,
    ...Object.entries(info?.links || {})
      .sort(([a], [b]) => linkOrder(a) - linkOrder(b))
      .map(([label, url]) => `[${linkLabel(label)}](${url})`)
  ].filter(Boolean);
  const description = [
    links.length ? `🔗 ${links.join(' · ')}` : null,
    info?.pronunciation ? `🗣️ Say it: **${info.pronunciation}**` : null,
    info?.notes ? `📝 ${info.notes}` : null,
    ...Object.entries(info?.extra || {}).map(([label, value]) => `${label}: ${value}`),
    lastOnStream ? `📺 Last on the main stream: ${lastOnStream}` : null
  ].filter(Boolean).join('\n');
  return { title: faction.name, description: description || null, fields };
}

// Builds the whole pack. Returns { embeds, signature, talkingPoints }.
export function buildPrepPack({
  match,
  seasonMatches = [],
  statsById = new Map(),
  teamInfo = [],
  veto = null,
  streamHistory = [],
  startIso = null,
  streamUrl = null,
  matchChannelId = null,
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
    return index >= 0 ? `${ordinal(index + 1)} of ${standings.length} in Group ${String(match.group).replace(/^Group\s+/i, '')} (${standings[index].wins}-${standings[index].losses})` : null;
  };
  const vetoInfo = vetoSummary({ veto, match });
  const h2h = seasonA.results.filter((result) => (teamB.id && result.opponentId === teamB.id) || teamKey(result.opponent) === teamKey(teamB.name));
  const lastStream = (team) => {
    const played = streamHistory
      .filter((entry) => entry.matchId !== match.id && entry.startMs < now)
      .map((entry) => ({ entry, match: seasonMatches.find((candidate) => candidate.id === entry.matchId) }))
      .filter(({ match: candidate }) => candidate && factions(candidate).some((faction) => sameTeam(faction, team)))
      .sort((x, y) => y.entry.startMs - x.entry.startMs)[0];
    if (!played) return null;
    const result = isFinished(played.match) ? teamResult(played.match, team, statsById) : null;
    return `${linked(`${shortDate(played.entry.startMs)} vs ${result?.opponent || 'TBD'}`, played.match.faceitUrl)}${result ? ` (${result.won ? 'won' : 'lost'} ${result.series})` : ''}`;
  };

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
  const recordOn = (season, mapName) => {
    const entry = season.mapPool.find((map) => map.map === mapName);
    return entry ? `${entry.won}-${entry.lost}` : 'unplayed';
  };
  const mapsValue = vetoInfo.maps.length
    ? [
      ...vetoInfo.maps.map((entry, index) => `**Map ${index + 1}: ${entry.map}**${entry.note ? ` (${entry.note})` : ''} · ${teamA.name} ${recordOn(seasonA, entry.map)}, ${teamB.name} ${recordOn(seasonB, entry.map)}`),
      vetoInfo.bans.length ? `Bans: ${vetoInfo.bans.join(', ')}` : null
    ].filter(Boolean).join('\n')
    : vetoInfo.state === 'in progress' ? 'Veto in progress.' : 'Veto not done yet. This updates when it is.';
  const links = [
    match.faceitUrl ? `[FACEIT room](${match.faceitUrl})` : null,
    matchChannelId ? `<#${matchChannelId}>` : null,
    streamUrl ? `[Stream](${streamUrl})` : null
  ].filter(Boolean).join(' · ');
  const matchCard = {
    title: `🎙️ Prep · ${teamA.name} vs ${teamB.name}`,
    description: [stamp, [match.round, match.group ? `Group ${String(match.group).replace(/^Group\s+/i, '')}` : null].filter(Boolean).join(' · ') || null, links || null].filter(Boolean).join('\n'),
    fields: [
      whatsAtStake(match) ? { name: "What's at stake", value: whatsAtStake(match) } : null,
      { name: 'Maps', value: mapsValue.slice(0, 1024) },
      {
        name: 'Head-to-head',
        value: h2h.length
          ? h2h.map((result) => `${linked(`${result.won ? teamA.name : teamB.name} won ${result.won ? result.series : result.series.split('-').reverse().join('-')}`, result.url)} · ${shortDate(result.timeMs)}${result.maps.length ? ` (${result.maps.map(mapLine).join(', ')})` : ''}`).join('\n').slice(0, 1024)
          : 'First meeting this season.'
      },
      { name: 'Talking points', value: talkingPoints.map((point) => `• ${point}`).join('\n').slice(0, 1024) }
    ].filter(Boolean)
  };
  return {
    embeds: [
      matchCard,
      teamCard(a, seasonA, findTeamInfo(teamInfo, a.name), standingFor(teamA), lastStream(teamA)),
      teamCard(b, seasonB, findTeamInfo(teamInfo, b.name), standingFor(teamB), lastStream(teamB))
    ],
    signature: prepSignature(match, vetoInfo),
    vetoState: vetoInfo.state,
    talkingPoints
  };
}
