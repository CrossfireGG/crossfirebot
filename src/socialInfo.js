// Social info for the Social Media team: facts, not finished posts. The daily "Tonight on stream"
// roundup (main stream with its production crew, plus every community-cast game), a detailed card
// per main stream match, and weekly "this week" / "last week" cards. Pure functions; index.js
// gathers the data and posts.

const ET = 'America/New_York';
const CT = 'America/Chicago';

// Team Info columns that hold social handles (kept out of prep notes and prep links).
export const SOCIAL_COLUMNS = {
  x: ['x', 'twitter', 'x (twitter)', 'x/twitter', 'twitter/x'],
  instagram: ['instagram', 'ig', 'insta']
};
const SOCIAL_KEYS = new Set(Object.values(SOCIAL_COLUMNS).flat());

export function isSocialColumn(label) {
  return SOCIAL_KEYS.has(String(label || '').trim().toLowerCase());
}

// "@FBH_CS", "FBH_CS", "https://x.com/FBH_CS", "instagram.com/fbh/" -> "@FBH_CS" / "@fbh".
export function normalizeHandle(value) {
  const text = String(value || '').trim();
  if (!text || /^(none|n\/a|-|—)$/i.test(text)) return null;
  const url = text.match(/^(?:https?:\/\/)?(?:www\.)?(?:x|twitter|instagram)\.com\/@?([A-Za-z0-9_.]{1,30})/i);
  if (url) return `@${url[1]}`;
  const handle = text.replace(/^@/, '');
  return /^[A-Za-z0-9_.]{1,30}$/.test(handle) ? `@${handle}` : null;
}

// A team's X and Instagram handles from its Team Info row (link or plain text).
export function teamSocials(info) {
  const found = { x: null, instagram: null };
  if (!info) return found;
  for (const [platform, labels] of Object.entries(SOCIAL_COLUMNS)) {
    for (const label of labels) {
      const fromLink = info.links?.[label];
      const fromText = Object.entries(info.extra || {}).find(([key]) => key.trim().toLowerCase() === label)?.[1];
      const handle = normalizeHandle(fromLink || fromText);
      if (handle) {
        found[platform] = handle;
        break;
      }
    }
  }
  return found;
}

// "FUELED BY HATE (@FBH_CS)" or just the name. Only X handles are shown.
export function taggedName(name, socials = {}) {
  return socials.x ? `${name} (${socials.x})` : name;
}

export function timeEt(ms) {
  return `${new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' }).format(new Date(ms))} ET`;
}

export function timeEtCt(ms) {
  const ct = new Intl.DateTimeFormat('en-US', { timeZone: CT, hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
  return `${timeEt(ms)} / ${ct} CT`;
}

export function dayLabel(ms) {
  return new Intl.DateTimeFormat('en-US', { timeZone: ET, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(ms));
}

function streamLabel(url) {
  const match = String(url || '').match(/^https?:\/\/(?:www\.)?([^/]+)\/(?:c\/|channel\/|user\/)?@?([^/?#]+)/i);
  return match ? `${match[1].replace(/^m\./, '')}/${match[2]}` : String(url || '');
}

function linkTo(url) {
  return url ? `[${streamLabel(url)}](${url})` : '';
}

function crewLines(crew = {}) {
  const casters = (crew.casters || []).filter(Boolean);
  return [
    casters.length ? `🎙️ Casters: ${casters.map((id) => `<@${id}>`).join(' & ')}` : '🎙️ Casters: TBD',
    [crew.producer ? `🎬 Producer: <@${crew.producer}>` : null, crew.observer ? `👁️ Observer: <@${crew.observer}>` : null].filter(Boolean).join(' · ') || null
  ].filter(Boolean);
}

// Daily "Tonight on stream". mainStream: [{ startMs, teamA, teamB, socialsA, socialsB, streamUrl, crew }];
// community: [{ startMs, teamA, teamB, socialsA, socialsB, casts: [{ url, userId }], alsoMainStream }].
export function buildRoundup({ dateMs, mainStream = [], community = [] }) {
  const lines = [];
  if (mainStream.length) {
    lines.push('**🎥 Main stream**');
    for (const match of [...mainStream].sort((a, b) => a.startMs - b.startMs)) {
      lines.push(`**${timeEt(match.startMs)}** · ${taggedName(match.teamA, match.socialsA)} vs ${taggedName(match.teamB, match.socialsB)}`);
      if (match.streamUrl) lines.push(`📺 ${linkTo(match.streamUrl)}`);
      lines.push(...crewLines(match.crew), '');
    }
  }
  if (community.length) {
    lines.push('**🎙️ Community streams**');
    for (const match of [...community].sort((a, b) => a.startMs - b.startMs)) {
      const casts = match.casts.map((cast) => `${linkTo(cast.url)}${cast.userId ? ` (<@${cast.userId}>)` : ''}`);
      lines.push(`**${timeEt(match.startMs)}** · ${taggedName(match.teamA, match.socialsA)} vs ${taggedName(match.teamB, match.socialsB)}${match.alsoMainStream ? ' · also on the main stream' : ''}`);
      lines.push(`  ${casts.join(' & ')}${casts.length > 1 ? ' (co-cast)' : ''}`);
    }
  }
  return {
    title: `📣 Tonight on stream · ${dayLabel(dateMs)}`,
    description: (lines.length ? lines.join('\n').trim() : 'Nothing on stream tonight.').slice(0, 4000)
  };
}

// The most kills in a finished match (ties: higher ADR), with the player's team.
export function matchTopPlayer(stats) {
  const players = new Map();
  for (const map of stats?.maps || []) {
    for (const team of map.teams || []) {
      for (const player of team.players || []) {
        const entry = players.get(player.playerId) || { nickname: player.nickname, team: team.name, kills: 0, deaths: 0, adrTotal: 0, maps: 0 };
        entry.kills += player.kills;
        entry.deaths += player.deaths;
        entry.adrTotal += player.adr;
        entry.maps += 1;
        players.set(player.playerId, entry);
      }
    }
  }
  const best = [...players.values()].sort((a, b) => b.kills - a.kills || (b.adrTotal / b.maps) - (a.adrTotal / a.maps))[0];
  return best ? { ...best, adr: best.maps ? best.adrTotal / best.maps : 0 } : null;
}

// The detailed card for one main stream match, 2 hours before. `state`: 'upcoming' | 'live' | 'done'.
export function buildSocialCard({
  startMs,
  teamA,
  teamB,
  socialsA = {},
  socialsB = {},
  streamUrl = null,
  crew = {},
  round = null,
  group = null,
  storylines = [],
  stars = [],
  maps = [],
  state = 'upcoming',
  result = null,
  topPlayer = null
}) {
  const lines = [];
  if (state === 'live') lines.push('🔴 **LIVE NOW**', '');
  if (state === 'done' && result) lines.push(`🏆 **Final: ${result}**`, '');
  lines.push(
    `**When:** ${dayLabel(startMs)} · ${timeEtCt(startMs)}`,
    streamUrl ? `**Stream:** ${linkTo(streamUrl)}` : null,
    ...crewLines(crew),
    [round, group ? `Group ${String(group).replace(/^Group\s+/i, '')}` : null].filter(Boolean).length ? `**Round:** ${[round, group ? `Group ${String(group).replace(/^Group\s+/i, '')}` : null].filter(Boolean).join(' · ')}` : null,
    '',
    '**X tags**',
    `${teamA}: ${socialsA.x || 'none on file'}`,
    `${teamB}: ${socialsB.x || 'none on file'}`
  );
  if (storylines.length) lines.push('', '**Storylines**', ...storylines.slice(0, 4).map((line) => `• ${line}`));
  if (stars.length) lines.push('', '**Players to watch**', ...stars.map((star) => `${star.team}: ${star.nickname}, ${star.kd.toFixed(2)} K/D, ${Math.round(star.adr)} ADR`));
  lines.push('', `**Maps:** ${maps.length ? maps.join(' → ') : 'not locked yet'}`);
  if (state === 'done' && topPlayer) {
    lines.push(`**Top player:** ${topPlayer.nickname} (${topPlayer.team}), ${topPlayer.kills} K · ${topPlayer.deaths} D · ${Math.round(topPlayer.adr)} ADR`);
  }
  return {
    title: `📣 Social info · ${teamA} vs ${teamB}`,
    description: lines.filter((line) => line !== null).join('\n').slice(0, 4000)
  };
}

// Monday: everything on stream this week, by day. items: [{ startMs, teamA, teamB, socialsA, socialsB, kind: 'main'|'community', streamUrl|casts }]
export function buildWeekAhead({ weekStartMs, items = [] }) {
  const byDay = new Map();
  for (const item of [...items].sort((a, b) => a.startMs - b.startMs)) {
    const day = dayLabel(item.startMs);
    if (!byDay.has(day)) byDay.set(day, []);
    const where = item.kind === 'main'
      ? `🎥 main stream ${linkTo(item.streamUrl)}`
      : `🎙️ ${item.casts.map((cast) => linkTo(cast.url)).join(' & ')}`;
    byDay.get(day).push(`${timeEt(item.startMs)} · ${taggedName(item.teamA, item.socialsA)} vs ${taggedName(item.teamB, item.socialsB)} · ${where}`);
  }
  const lines = [...byDay.entries()].flatMap(([day, entries]) => [`**${day}**`, ...entries, '']);
  return {
    title: `📅 This week on stream · week of ${dayLabel(weekStartMs)}`,
    description: (lines.length ? lines.join('\n').trim() : 'Nothing on stream scheduled yet this week.').slice(0, 4000)
  };
}

// Monday: last week's streamed results. results: [{ startMs, text, kind }]; topPlayer: { nickname, team, kd, adr, maps }.
export function buildWeekRecap({ weekStartMs, results = [], topPlayer = null }) {
  const main = results.filter((result) => result.kind === 'main').sort((a, b) => a.startMs - b.startMs);
  const community = results.filter((result) => result.kind !== 'main').sort((a, b) => a.startMs - b.startMs);
  const lines = [];
  if (main.length) lines.push('**🎥 Main stream**', ...main.map((result) => `${dayLabel(result.startMs)} · ${result.text}`), '');
  if (community.length) lines.push('**🎙️ Community streams**', ...community.map((result) => `${dayLabel(result.startMs)} · ${result.text}`), '');
  if (topPlayer) lines.push(`**Top performer:** ${topPlayer.nickname} (${topPlayer.team}), ${topPlayer.kd.toFixed(2)} K/D, ${Math.round(topPlayer.adr)} ADR over ${topPlayer.maps} map${topPlayer.maps === 1 ? '' : 's'}`);
  return {
    title: `🏆 Last week on stream · week of ${dayLabel(weekStartMs)}`,
    description: (lines.length ? lines.join('\n').trim() : 'No streamed matches finished last week.').slice(0, 4000)
  };
}

// Best K/D over several finished matches' stats (at least 2 maps), with the team.
export function weekTopPlayer(statsList) {
  const players = new Map();
  for (const stats of statsList) {
    for (const map of stats?.maps || []) {
      for (const team of map.teams || []) {
        for (const player of team.players || []) {
          const entry = players.get(player.playerId) || { nickname: player.nickname, team: team.name, kills: 0, deaths: 0, adrTotal: 0, maps: 0 };
          entry.kills += player.kills;
          entry.deaths += player.deaths;
          entry.adrTotal += player.adr;
          entry.maps += 1;
          players.set(player.playerId, entry);
        }
      }
    }
  }
  const ranked = [...players.values()]
    .filter((player) => player.maps >= 2)
    .map((player) => ({ ...player, kd: player.deaths ? player.kills / player.deaths : player.kills, adr: player.adrTotal / player.maps }))
    .sort((a, b) => b.kd - a.kd);
  return ranked[0] || null;
}
