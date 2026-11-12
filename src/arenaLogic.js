// Crossfire Arena 10mans: the pure parts (no Discord, no network), so they can be tested.
// The bot side is src/arena.js.

const OVER_STATUSES = new Set(['FINISHED', 'CANCELLED', 'ABORTED']);

// A name for comparing: lowercase letters and digits only ("Zoro-" and "zoro" are the same).
export function arenaNameKey(name) {
  return String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
}

export function arenaMatchOver(status) {
  return OVER_STATUSES.has(String(status || '').toUpperCase());
}

// The two teams of a FACEIT match: [{ faction, name, label, players: [{ playerId, nickname, steamId }] }].
export function arenaTeams(match) {
  return ['faction1', 'faction2'].map((faction, index) => {
    const team = match?.teams?.[faction] || {};
    const players = (Array.isArray(team.roster) ? team.roster : (team.players || []))
      .map((player) => ({
        playerId: String(player.player_id || player.id || '').trim(),
        nickname: String(player.nickname || player.game_player_name || '').trim(),
        steamId: /^\d{17}$/.test(String(player.game_player_id || '')) ? String(player.game_player_id) : ''
      }))
      .filter((player) => player.playerId);
    return { faction, name: String(team.name || '').trim(), label: arenaTeamLabel(team.name, index), players };
  });
}

// "team_Zoro" (how FACEIT names drafted hub teams) -> "Team Zoro".
export function arenaTeamLabel(name, index = 0) {
  const text = String(name || '').trim();
  if (!text) return index === 0 ? 'Team A' : 'Team B';
  return text.replace(/^team[_\s-]+/i, 'Team ');
}

// Teams are final (the captain draft on FACEIT is done) and both sides are full.
export function arenaTeamsLocked(match, teamSize = 5) {
  const status = String(match?.status || '').toUpperCase();
  if (!status || arenaMatchOver(status)) return false;
  if (/CAPTAIN|PICK|DRAFT|CHECK_?IN|SUBSTITUT/.test(status)) return false;
  const teams = arenaTeams(match);
  return teams.every((team) => team.players.length >= teamSize);
}

export function arenaFaceitUrl(match) {
  const url = String(match?.faceit_url || '').replace('{lang}', 'en');
  if (url) return url;
  return match?.match_id ? `https://www.faceit.com/en/cs2/room/${match.match_id}` : '';
}

// The voice channel name for one team: "🔵 Arena 12 · Team Zoro".
export function arenaChannelName(number, team, index) {
  return `${index === 0 ? '🔵' : '🔴'} Arena ${number} · ${team.label}`.slice(0, 100);
}

export function isArenaChannelName(name) {
  return /^(🔵|🔴) Arena \d+ · /u.test(String(name || ''));
}

// FACEIT players nobody has linked yet, matched to Discord members by name. Only a name that
// fits exactly one member (and that member fits exactly one player) counts, and members who are
// already linked to another FACEIT account are left out.
//   players: [{ playerId, nickname }]   members: [{ id, names: [...] }]   takenDiscordIds: Set
// Returns Map playerId -> discord id.
export function matchArenaPlayersByName(players, members, takenDiscordIds = new Set()) {
  const free = members.filter((member) => !takenDiscordIds.has(member.id));
  const candidates = new Map();
  for (const player of players) {
    const key = arenaNameKey(player.nickname);
    if (!key) continue;
    const hits = free.filter((member) => (member.names || []).some((name) => arenaNameKey(name) === key));
    if (hits.length === 1) candidates.set(player.playerId, hits[0].id);
  }
  const counts = new Map();
  for (const id of candidates.values()) counts.set(id, (counts.get(id) || 0) + 1);
  return new Map([...candidates].filter(([, id]) => counts.get(id) === 1));
}

// Roster Tracking (CSV): SteamID64 -> the Discord cell (column C) for every league player.
export function parseRosterSteamDiscord(csvText) {
  const map = new Map();
  for (const row of parseCsv(csvText)) {
    const discord = String(row[2] || '').trim();
    if (!discord) continue;
    for (const cell of row) {
      const steamId = String(cell || '').replace(/\s+/g, '');
      if (/^7656119\d{10}$/.test(steamId)) {
        if (!map.has(steamId)) map.set(steamId, discord);
        break;
      }
    }
  }
  return map;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const input = String(text || '');
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Someone joining voice gets dragged to their team only when they connect (from no channel) or
// walk into the Queue. Moving between other channels on purpose is left alone.
export function arenaDragOnJoin(oldChannelId, newChannelId, queueChannelId) {
  if (!newChannelId || newChannelId === oldChannelId) return false;
  return !oldChannelId || newChannelId === queueChannelId;
}

// Can this FACEIT account be linked to this Discord account?
//   links: { [playerId]: { discordId, nickname } }
// { ok: true } | { ok: false, reason: 'taken' | 'other', existing }
//   taken: the FACEIT account is linked to someone else
//   other: this Discord account is already linked to a different FACEIT account
export function arenaLinkConflict(links, { playerId, discordId }) {
  const current = links?.[playerId];
  if (current && current.discordId !== discordId) return { ok: false, reason: 'taken', existing: current };
  const other = Object.values(links || {}).find((link) => link.discordId === discordId && link.playerId !== playerId);
  if (other) return { ok: false, reason: 'other', existing: other };
  return { ok: true };
}

// A FACEIT nickname from what someone typed: a nickname, @nickname, or a profile link.
export function parseFaceitNickname(text) {
  const value = String(text || '').trim();
  const fromUrl = value.match(/faceit\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?players\/([^/?#\s]+)/i);
  const nickname = fromUrl ? decodeURIComponent(fromUrl[1]) : value.replace(/^@/, '');
  return /^[^\s/?#@]{2,32}$/u.test(nickname) ? nickname : null;
}

// Which linked Discord members belong in each team channel: { faction1: [ids], faction2: [ids] },
// plus the players nobody is linked to yet.
export function arenaResolveTeams(teams, links) {
  const members = {};
  const unknown = [];
  for (const team of teams) {
    members[team.faction] = [];
    for (const player of team.players) {
      const discordId = links?.[player.playerId]?.discordId;
      if (discordId) members[team.faction].push(discordId);
      else unknown.push({ ...player, faction: team.faction });
    }
  }
  return { members, unknown };
}
