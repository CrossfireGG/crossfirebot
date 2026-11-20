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

// ---------- change notices ----------
// An edit to a post is silent, so when something already announced changes, a short notice says
// what it was and what it is now.

// The facts of a main stream match that a social post could have used.
export function mainStreamFacts({ startMs = null, teamA, teamB, streamUrl = null, crew = {} } = {}) {
  return {
    startMs: Number.isFinite(startMs) ? startMs : null,
    matchup: `${teamA} vs ${teamB}`,
    streamUrl: streamUrl || null,
    casters: (crew.casters || []).filter(Boolean),
    producer: crew.producer || null,
    observer: crew.observer || null
  };
}

function whenLabel(ms) {
  return Number.isFinite(ms) && ms ? `${dayLabel(ms)} · ${timeEt(ms)}` : 'TBD';
}

function peopleLabel(ids, none = 'TBD') {
  const list = [].concat(ids || []).filter(Boolean);
  return list.length ? list.map((id) => `<@${id}>`).join(' & ') : none;
}

// "**Producer:** ~~<@3>~~ → <@4>" for every fact that differs. Casters swapping order is not a change.
export function describeMainStreamChanges(before, after) {
  if (!before || !after) return [];
  const sameCasters = [...(before.casters || [])].sort().join() === [...(after.casters || [])].sort().join();
  const rows = [
    ['Teams', before.matchup, after.matchup],
    ['Time', whenLabel(before.startMs), whenLabel(after.startMs)],
    ['Stream', streamLabel(before.streamUrl) || 'TBD', linkTo(after.streamUrl) || 'TBD', streamLabel(before.streamUrl) === streamLabel(after.streamUrl)],
    ['Casters', peopleLabel(before.casters), peopleLabel(after.casters), sameCasters],
    ['Producer', peopleLabel(before.producer), peopleLabel(after.producer)],
    ['Observer', peopleLabel(before.observer, 'none'), peopleLabel(after.observer, 'none')]
  ];
  return rows
    .filter(([, was, now, same = was === now]) => !same)
    .map(([label, was, now]) => `**${label}:** ~~${was}~~ → ${now}`);
}

// Tonight's community casts by match, for comparing two readings.
export function communityFacts(community = []) {
  return Object.fromEntries(community
    .map((match) => [String(match.matchId || `${match.teamA} vs ${match.teamB}`), {
      startMs: match.startMs,
      matchup: `${match.teamA} vs ${match.teamB}`,
      casts: (match.casts || []).map((cast) => cast.url).sort()
    }])
    .sort(([a], [b]) => a.localeCompare(b)));
}

export function describeCommunityChanges(before = {}, after = {}) {
  const lines = [];
  const channels = (casts) => casts.map(linkTo).join(' & ');
  for (const [key, now] of Object.entries(after)) {
    const was = before[key];
    if (!was) {
      lines.push(`➕ **Added:** ${now.matchup} · ${timeEt(now.startMs)} · ${channels(now.casts)}`);
      continue;
    }
    const parts = [];
    if (timeEt(was.startMs) !== timeEt(now.startMs)) parts.push(`~~${timeEt(was.startMs)}~~ → ${timeEt(now.startMs)}`);
    if (was.casts.join() !== now.casts.join()) parts.push(`~~${was.casts.map(streamLabel).join(' & ')}~~ → ${channels(now.casts)}`);
    if (parts.length) lines.push(`✏️ **${now.matchup}:** ${parts.join(' · ')}`);
  }
  for (const [key, was] of Object.entries(before)) {
    if (!after[key]) lines.push(`➖ **No longer tonight:** ${was.matchup} (${timeEt(was.startMs)}), cancelled or moved`);
  }
  return lines;
}

const CHECK_POSTS = 'Check anything already posted or scheduled.';

export function buildChangeCard({ title, lines = [] }) {
  return {
    title: `🔄 Change · ${title}`,
    description: [...lines, '', `The posts in this channel are updated. ${CHECK_POSTS}`].join('\n').slice(0, 4000)
  };
}

// A match put on the main stream after that night's roundup went up.
export function buildAddedCard({ startMs, teamA, teamB, streamUrl = null, crew = {} }) {
  return {
    title: `➕ Now on the main stream · ${teamA} vs ${teamB}`,
    description: [
      `**When:** ${dayLabel(startMs)} · ${timeEtCt(startMs)}`,
      streamUrl ? `**Stream:** ${linkTo(streamUrl)}` : null,
      ...crewLines(crew),
      '',
      'Added after tonight\'s roundup, which is updated.'
    ].filter((line) => line !== null).join('\n')
  };
}

// A match taken off the main stream.
export function buildRemovedCard({ startMs = null, teamA, teamB }) {
  return {
    title: `❌ Off the main stream · ${teamA} vs ${teamB}`,
    description: [
      startMs ? `**Was:** ${dayLabel(startMs)} · ${timeEtCt(startMs)}` : null,
      'This match is no longer on the main stream.',
      '',
      CHECK_POSTS
    ].filter((line) => line !== null).join('\n')
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

// The before-game card for one main stream match, 2 hours before. `state`: 'upcoming' | 'live'
// (adds LIVE NOW) | 'over' (back to plain facts once the match ends; the result is its own post).
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
  stakes = [],
  form = null,
  h2h = null,
  state = 'upcoming'
}) {
  const lines = [];
  if (state === 'live') lines.push('🔴 **LIVE NOW**', '');
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
  if (stakes?.length) lines.push('', "**What's at stake**", ...stakes);
  if (form?.length) {
    lines.push('', '**Form**', ...form.map((team) => (team.wins + team.losses
      ? `${team.name}: ${team.wins}-${team.losses}${team.streak ? ` · ${team.streak} streak` : ''}${team.standing ? ` · ${team.standing}` : ''}`
      : `${team.name}: first match of the season`)));
  }
  if (Array.isArray(h2h)) lines.push('', '**Head to head**', ...(h2h.length ? h2h : ['First meeting this season.']));
  // Rematch / first-meeting lines are covered by Head to head above.
  const extra = storylines.filter((line) => !Array.isArray(h2h) || !/^(Rematch:|First meeting)/.test(line));
  if (extra.length) lines.push('', '**Storylines**', ...extra.slice(0, 4).map((line) => `• ${line}`));
  if (stars.length) lines.push('', '**Players to watch**', ...stars.map((star) => `${star.team}: ${star.nickname}, ${star.kd.toFixed(2)} K/D, ${Math.round(star.adr)} ADR`));
  lines.push('', `**Maps:** ${maps.length ? maps.join(' → ') : 'not locked yet'}`);
  return {
    title: `📣 Social info · ${teamA} vs ${teamB}`,
    description: lines.filter((line) => line !== null).join('\n').slice(0, 4000)
  };
}

// The after-game post for one main stream match, sent as its own message once FACEIT finishes it.
// `result` is the match result text: "Celestial Esports won 2-1 (Mirage 13-9, Nuke 14-16, Ancient 13-11)".
export function buildSocialResultCard({ teamA, teamB, socialsA = {}, socialsB = {}, streamUrl = null, result, topPlayer = null }) {
  const [, headline = result, detail = ''] = String(result || '').match(/^(.*?)\s*\((.*)\)$/) || [];
  const maps = detail ? detail.split(/,\s*/) : [];
  const lines = [
    `**Final:** ${headline}`,
    maps.length ? '' : null,
    maps.length ? '**Maps**' : null,
    ...maps,
    topPlayer ? '' : null,
    topPlayer ? `**Top player:** ${topPlayer.nickname} (${topPlayer.team}), ${topPlayer.kills} K · ${topPlayer.deaths} D · ${Math.round(topPlayer.adr)} ADR` : null,
    '',
    '**X tags**',
    `${teamA}: ${socialsA.x || 'none on file'}`,
    `${teamB}: ${socialsB.x || 'none on file'}`,
    streamUrl ? '' : null,
    streamUrl ? `**Stream:** ${linkTo(streamUrl)}` : null
  ];
  return {
    title: `🏆 Final · ${teamA} vs ${teamB}`,
    description: lines.filter((line) => line !== null).join('\n').slice(0, 4000)
  };
}
