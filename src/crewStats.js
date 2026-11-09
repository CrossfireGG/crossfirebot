// Season crew stats: community casts per caster, and main stream matches per person per role.
// Main stream crews come from `/cf mainstream` and from Schedule channel posts imported with
// `/cf crewimport` (posts made by hand before the bot kept crews).

export const STAT_ROLES = ['caster', 'producer', 'observer', 'admin', 'social'];
export const STAT_ROLE_LABELS = { caster: 'Casters', producer: 'Producers', observer: 'Observers', admin: 'Admin', social: 'Social Media' };
const ROLE_NAMES = { caster: 'Caster', producer: 'Producer', observer: 'Observer', admin: 'Admin', social: 'Social' };

const ROLE_LINE = /^(casters?|cast|prod(?:ucer)?s?|obs(?:erver)?s?|admins?|social(?:\s*media)?|smm)\s*:\s*(.*)$/i;
const FACEIT_ROOM = /https?:\/\/(?:www\.)?faceit\.com\/[^\s>)]*?\/room\/(1-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[^\s>)]*/i;
const EMPTY_NAMES = /^(tbd|tba|none|n\/a|-|—|\?|x)$/i;

function roleKey(label) {
  const value = label.toLowerCase();
  if (value.startsWith('cast')) return 'caster';
  if (value.startsWith('prod')) return 'producer';
  if (value.startsWith('obs')) return 'observer';
  if (value.startsWith('admin')) return 'admin';
  return 'social';
}

// Reads one Schedule channel post (the bot's or one typed by hand):
//   date / time / Team VS Team / FACEIT link / Casters: @A & @B / Prod: @C / Obs: @D / Streams: ...
// -> { matchId, faceitUrl, matchupText, crew, names, timestampMs, cancelled } or null if it has no
// crew lines. `names` holds people written as plain text instead of @mentions, by role.
export function parseSchedulePost(content) {
  const text = String(content || '');
  const segments = text
    .replace(/\*\*|__|`/g, '')
    .split(/\n|\s\/\s/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const crew = { casters: [], producer: null, observer: null, admin: null, social: null };
  const names = {};
  let hasCrewLine = false;
  let matchupText = null;
  for (const segment of segments) {
    const line = segment.match(ROLE_LINE);
    if (!line) {
      if (!matchupText && /\s+vs\.?\s+/i.test(segment) && !/https?:\/\//i.test(segment)) matchupText = segment.replace(/\s+/g, ' ').trim();
      continue;
    }
    hasCrewLine = true;
    const role = roleKey(line[1]);
    const ids = [...line[2].matchAll(/<@!?(\d{17,20})>/g)].map((match) => match[1]);
    const typed = line[2]
      .replace(/<@!?\d{17,20}>/g, ' ')
      .split(/&|,|\band\b|\+/i)
      .map((name) => name.replace(/^@/, '').trim())
      .filter((name) => name && !EMPTY_NAMES.test(name));
    if (role === 'caster') crew.casters.push(...ids);
    else if (ids[0] && !crew[role]) crew[role] = ids[0];
    if (typed.length) names[role] = [...(names[role] || []), ...typed];
  }
  if (!hasCrewLine) return null;
  crew.casters = [...new Set(crew.casters)].slice(0, 2);
  const room = text.match(FACEIT_ROOM);
  const stamp = text.match(/<t:(\d{9,11})(?::[a-zA-Z])?>/);
  return {
    matchId: room ? room[1] : null,
    faceitUrl: room ? room[0] : null,
    matchupText,
    crew,
    names,
    timestampMs: stamp ? Number(stamp[1]) * 1000 : null,
    cancelled: /CANCELLED/.test(text) || /no longer on the main stream/i.test(text)
  };
}

// The post text without links, mentions and timestamps, for reading a typed date and time.
export function schedulePostDateText(content) {
  return String(content || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/<[@#&!:a-z]*\d+(?::[a-z])?>/gi, ' ')
    .split(/\n|\s\/\s/)
    .filter((segment) => !ROLE_LINE.test(segment.trim()) && !/\s+vs\.?\s+/i.test(segment) && !/^streams?\s*:/i.test(segment.trim()))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function crewEntries(crew = {}) {
  const entries = [];
  for (const id of crew.casters || []) entries.push(['caster', id]);
  for (const role of ['producer', 'observer', 'admin', 'social']) if (crew[role]) entries.push([role, crew[role]]);
  return entries;
}

// Season counts. `mainStream`: [{ matchId, startMs, crew, matchup }]; `community`:
// [{ requesterId, startMs, matchup }]. `inSeason(startMs)` decides what belongs to the season.
// Matches that already started count as done; later ones as booked.
export function computeSeasonCrewStats({ mainStream = [], community = [], inSeason = () => true, now = Date.now() } = {}) {
  const roles = Object.fromEntries(STAT_ROLES.map((role) => [role, new Map()]));
  const casts = new Map();
  const bump = (map, id, done) => {
    const entry = map.get(id) || { done: 0, booked: 0 };
    if (done) entry.done += 1;
    else entry.booked += 1;
    map.set(id, entry);
  };
  let mainStreamMatches = 0;
  for (const match of mainStream) {
    if (!Number.isFinite(match.startMs) || !inSeason(match.startMs)) continue;
    mainStreamMatches += 1;
    const seen = new Set();
    for (const [role, id] of crewEntries(match.crew)) {
      if (seen.has(`${role}:${id}`)) continue;
      seen.add(`${role}:${id}`);
      bump(roles[role], id, match.startMs <= now);
    }
  }
  let communityCasts = 0;
  for (const cast of community) {
    if (!cast.requesterId || !Number.isFinite(cast.startMs) || !inSeason(cast.startMs)) continue;
    communityCasts += 1;
    bump(casts, cast.requesterId, cast.startMs <= now);
  }
  const rank = (map) => [...map.entries()]
    .map(([id, entry]) => ({ id, ...entry }))
    .sort((a, b) => b.done - a.done || b.booked - a.booked || a.id.localeCompare(b.id));
  return {
    mainStreamMatches,
    communityCasts,
    roles: Object.fromEntries(STAT_ROLES.map((role) => [role, rank(roles[role])])),
    community: rank(casts)
  };
}

// One person's season: their main stream matches (with roles) and community casts, newest first.
export function personSeasonHistory(userId, { mainStream = [], community = [], inSeason = () => true } = {}) {
  const matches = [];
  for (const match of mainStream) {
    if (!Number.isFinite(match.startMs) || !inSeason(match.startMs)) continue;
    const roles = [...new Set(crewEntries(match.crew).filter(([, id]) => id === userId).map(([role]) => ROLE_NAMES[role]))];
    if (roles.length) matches.push({ kind: 'main', startMs: match.startMs, matchup: match.matchup, roles });
  }
  for (const cast of community) {
    if (cast.requesterId !== userId || !Number.isFinite(cast.startMs) || !inSeason(cast.startMs)) continue;
    matches.push({ kind: 'community', startMs: cast.startMs, matchup: cast.matchup, roles: ['Community cast'] });
  }
  return matches.sort((a, b) => b.startMs - a.startMs);
}

// "<@1> 6 · <@2> 4 (+1)" within Discord's 1024-character field limit.
export function formatRanking(entries, limit = 1000) {
  if (!entries.length) return 'Nobody yet.';
  const parts = entries.map((entry) => `<@${entry.id}> ${entry.done}${entry.booked ? ` (+${entry.booked})` : ''}`);
  let text = '';
  for (let index = 0; index < parts.length; index += 1) {
    const next = text ? `${text} · ${parts[index]}` : parts[index];
    if (next.length > limit - 20) return `${text} · … +${parts.length - index} more`;
    text = next;
  }
  return text;
}
