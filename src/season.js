// Seasons and their round windows, set by staff with `/cf season`.
//
// A season is a name plus an Eastern-time date range (end optional while it is running) and a list
// of rounds. Each round has its own scheduling window and an optional default match date/time. The
// match-room intro, `!schedule` validation and `/crossfire rounds` all read the current season's rounds.
// Everything here is pure so it can be tested without Discord.

export const SEASON_TIME_ZONE = 'America/New_York';
const MAX_SEASON_NAME_LENGTH = 60;
const MAX_ROUND_NAME_LENGTH = 60;
const OPEN_END = '9999-12-31';

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// FACEIT and staff use several names for the same playoff round; all map to one canonical name.
export const PLAYOFF_ROUND_NAMES = new Map([
  ['wb round of 32', 'Upper Bracket - Round 1'],
  ['winner bracket round 1', 'Upper Bracket - Round 1'],
  ['winners bracket round 1', 'Upper Bracket - Round 1'],
  ['upper bracket round 1', 'Upper Bracket - Round 1'],
  ['wb round of 16', 'Upper Bracket - Round 2'],
  ['winner bracket round 2', 'Upper Bracket - Round 2'],
  ['winners bracket round 2', 'Upper Bracket - Round 2'],
  ['upper bracket round 2', 'Upper Bracket - Round 2'],
  ['wb quarterfinals', 'Upper Bracket - Round 3'],
  ['wb quarter finals', 'Upper Bracket - Round 3'],
  ['upper bracket round 3', 'Upper Bracket - Round 3'],
  ['wb semifinals', 'Upper Bracket - Round 4'],
  ['wb semi finals', 'Upper Bracket - Round 4'],
  ['upper bracket round 4', 'Upper Bracket - Round 4'],
  ['wb final', 'Upper Bracket - Round 5'],
  ['upper bracket final', 'Upper Bracket - Round 5'],
  ['upper bracket round 5', 'Upper Bracket - Round 5'],
  ['losers round 1', 'Lower Bracket - Round 1'],
  ['lower round 1', 'Lower Bracket - Round 1'],
  ['lower bracket round 1', 'Lower Bracket - Round 1'],
  ['losers round 2', 'Lower Bracket - Round 2'],
  ['lower round 2', 'Lower Bracket - Round 2'],
  ['lower bracket round 2', 'Lower Bracket - Round 2'],
  ['losers round 3', 'Lower Bracket - Round 3'],
  ['lower round 3', 'Lower Bracket - Round 3'],
  ['lower bracket round 3', 'Lower Bracket - Round 3'],
  ['losers round 4', 'Lower Bracket - Round 4'],
  ['lower round 4', 'Lower Bracket - Round 4'],
  ['lower bracket round 4', 'Lower Bracket - Round 4'],
  ['losers round 5', 'Lower Bracket - Round 5'],
  ['lower round 5', 'Lower Bracket - Round 5'],
  ['lower bracket round 5', 'Lower Bracket - Round 5'],
  ['losers round 6', 'Lower Bracket - Round 6'],
  ['lower round 6', 'Lower Bracket - Round 6'],
  ['lower bracket round 6', 'Lower Bracket - Round 6'],
  ['losers round 7', 'Lower Bracket - Round 7'],
  ['lower round 7', 'Lower Bracket - Round 7'],
  ['lower bracket round 7', 'Lower Bracket - Round 7'],
  ['losers final', 'Lower Bracket - Round 8'],
  ['lower final', 'Lower Bracket - Round 8'],
  ['lower bracket final', 'Lower Bracket - Round 8'],
  ['lower bracket round 8', 'Lower Bracket - Round 8'],
  ['grand final', 'Grand Final (BO5)'],
  ['grand final bo5', 'Grand Final (BO5)']
]);

// The Season 7 Group Stage dates that used to be hard-coded in the bot. Copied into the store once,
// on the first start with no seasons, so match rooms keep the same windows until staff edit them.
export const LEGACY_SEASON_SEED = Object.freeze({
  id: 'season-7',
  name: 'Season 7',
  startDate: '2026-11-02',
  endDate: null,
  rounds: [
    { name: 'Group Stage', startDate: '2026-11-02', endDate: '2026-11-11', defaultDate: '2026-11-06', defaultTime: null },
    { name: 'Round 1', startDate: '2026-11-02', endDate: '2026-11-04', defaultDate: '2026-11-03', defaultTime: '20:00' },
    { name: 'Round 2', startDate: '2026-11-05', endDate: '2026-11-07', defaultDate: '2026-11-06', defaultTime: '20:00' },
    { name: 'Round 3', startDate: '2026-11-08', endDate: '2026-11-11', defaultDate: '2026-11-09', defaultTime: '20:00' }
  ]
});

// Season 7 playoff dates announced after the Group Stage. These are merged into the
// persisted Season 7 record once, without replacing rounds staff have already edited.
export const SEASON7_PLAYOFF_ROUNDS = Object.freeze([
  { name: 'Upper Bracket - Round 1', startDate: '2026-11-14', endDate: '2026-11-17', defaultDate: '2026-11-15', defaultTime: '20:00' },
  { name: 'Upper Bracket - Round 2', startDate: '2026-11-18', endDate: '2026-11-20', defaultDate: '2026-11-19', defaultTime: '20:00' },
  { name: 'Lower Bracket - Round 1', startDate: '2026-11-18', endDate: '2026-11-20', defaultDate: '2026-11-19', defaultTime: '20:00' },
  { name: 'Upper Bracket - Round 3', startDate: '2026-11-21', endDate: '2026-11-23', defaultDate: '2026-11-22', defaultTime: '20:00' },
  { name: 'Lower Bracket - Round 2', startDate: '2026-11-21', endDate: '2026-11-23', defaultDate: '2026-11-22', defaultTime: '20:00' },
  { name: 'Lower Bracket - Round 3', startDate: '2026-11-24', endDate: '2026-11-26', defaultDate: '2026-11-25', defaultTime: '20:00' },
  { name: 'Upper Bracket - Round 4', startDate: '2026-11-27', endDate: '2026-11-29', defaultDate: '2026-11-28', defaultTime: '20:00' },
  { name: 'Lower Bracket - Round 4', startDate: '2026-11-27', endDate: '2026-11-29', defaultDate: '2026-11-28', defaultTime: '20:00' },
  { name: 'Lower Bracket - Round 5', startDate: '2026-11-30', endDate: '2026-12-02', defaultDate: '2026-12-01', defaultTime: '20:00' },
  { name: 'Upper Bracket - Round 5', startDate: '2026-12-03', endDate: '2026-12-05', defaultDate: '2026-12-04', defaultTime: '20:00' },
  { name: 'Lower Bracket - Round 6', startDate: '2026-12-03', endDate: '2026-12-05', defaultDate: '2026-12-04', defaultTime: '20:00' },
  { name: 'Lower Bracket - Round 7', startDate: '2026-12-06', endDate: '2026-12-08', defaultDate: '2026-12-07', defaultTime: '20:00' },
  { name: 'Lower Bracket - Round 8', startDate: '2026-12-09', endDate: '2026-12-11', defaultDate: '2026-12-10', defaultTime: '20:00' },
  { name: 'Grand Final (BO5)', startDate: '2026-12-11', endDate: '2026-12-13', defaultDate: '2026-12-12', defaultTime: '20:00' }
]);

export function normalizeRoundName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\bquarter finals\b/g, 'quarterfinals')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// One key per round, so "WB Round of 32", "Upper Bracket - Round 1" and "upper bracket round 1"
// all find the same season row, and "Group Stage - Round 2" finds "Round 2".
export function roundKey(name) {
  const normalized = normalizeRoundName(name);
  if (!normalized) return '';
  const group = normalized.match(/^(?:group stage )?round (\d+)(?: group stage)?$/);
  if (group) return `round ${Number(group[1])}`;
  const canonical = PLAYOFF_ROUND_NAMES.get(normalized);
  return canonical ? normalizeRoundName(canonical) : normalized;
}

const KNOWN_ROUND_KEYS = new Set([
  'group stage',
  'playoff stage',
  ...[...PLAYOFF_ROUND_NAMES.values()].map((name) => normalizeRoundName(name))
]);

export function isKnownRoundName(name) {
  const key = roundKey(name);
  return KNOWN_ROUND_KEYS.has(key) || /^round \d+$/.test(key);
}

// ---------- dates ----------

function pad(value) {
  return String(value).padStart(2, '0');
}

function toKey(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function isRealDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function keyToUtc(key) {
  const [year, month, day] = String(key).split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function daysBetween(fromKey, toKeyValue) {
  return Math.round((keyToUtc(toKeyValue) - keyToUtc(fromKey)) / 86_400_000);
}

export function addDays(key, days) {
  const date = new Date(keyToUtc(key) + days * 86_400_000);
  return toKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

// Today's date in Eastern time as YYYY-MM-DD.
export function easternDateKey(date = new Date(), timeZone = SEASON_TIME_ZONE) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function monthFromWord(word) {
  const clean = String(word || '').replace(/\.$/, '');
  if (clean.length < 3) return null;
  const index = MONTH_NAMES.findIndex((month) => month.startsWith(clean) || (clean === 'sept' && month === 'september'));
  return index >= 0 ? index + 1 : null;
}

// Accepts 2026-11-02, 11/2, 11/2/2026, 11/2/26, Nov 2, November 2, 2026, Mon Nov 2.
// Without a year, `defaultYear` is used; when `after` is given and that lands far before it
// (a season crossing New Year), the next year is used instead.
export function parseSeasonDate(text, { defaultYear, after = null } = {}) {
  const value = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/(\d)(st|nd|rd|th)\b/g, '$1')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ');
  if (!value) return null;
  let year = null;
  let month = null;
  let day = null;
  let match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = value.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/))) {
    month = Number(match[1]);
    day = Number(match[2]);
    if (match[3]) year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  } else if ((match = value.match(/^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.? )?([a-z]+\.?) (\d{1,2})(?: (\d{4}))?$/))) {
    month = monthFromWord(match[1]);
    day = Number(match[2]);
    if (match[3]) year = Number(match[3]);
  } else {
    return null;
  }
  if (!month) return null;
  if (!year) {
    year = Number(defaultYear) || new Date().getUTCFullYear();
    if (after && isRealDate(year, month, day) && daysBetween(toKey(year, month, day), after) > 180) year += 1;
  }
  return isRealDate(year, month, day) ? toKey(year, month, day) : null;
}

// Accepts 8 PM, 8:30pm, 20:00, optionally followed by ET/EST/EDT. A bare "8" is rejected as ambiguous.
export function parseSeasonTime(text) {
  const value = String(text || '').trim().toLowerCase().replace(/\s*\b(et|est|edt|eastern)\b\.?$/, '').trim();
  const match = value.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3]?.replace(/\./g, '');
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0);
  } else if (match[2] === undefined || hour > 23) {
    return null;
  }
  return `${pad(hour)}:${pad(minute)}`;
}

export function formatLongDate(key) {
  const [year, month, day] = String(key).split('-').map(Number);
  return `${MONTH_NAMES[month - 1][0].toUpperCase()}${MONTH_NAMES[month - 1].slice(1)} ${day}, ${year}`;
}

function formatShortDate(key, referenceYear = null) {
  const [year, month, day] = String(key).split('-').map(Number);
  return year === referenceYear ? `${MONTH_SHORT[month - 1]} ${day}` : `${MONTH_SHORT[month - 1]} ${day}, ${year}`;
}

export function formatTime12(time) {
  const [hour, minute] = String(time).split(':').map(Number);
  return `${hour % 12 || 12}:${pad(minute)} ${hour >= 12 ? 'PM' : 'AM'}`;
}

export function formatSeasonRange(season) {
  const start = formatShortDate(season.startDate);
  return season.endDate ? `${start} – ${formatShortDate(season.endDate)}` : `${start} – no end date`;
}

// ---------- rounds text (the `/cf season action:rounds` form) ----------

const RANGE_SPLIT = /\s+(?:-|–|—|to|through|thru)\s+|\s*\.\.\s*/i;
const TRAILING_TIME = /\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)|\d{1,2}:\d{2})(?:\s*(?:et|est|edt|eastern))?\.?$/i;

function parseDefault(text, defaultYear, after) {
  const value = String(text || '').trim().replace(/\s+at\s+/i, ' ');
  if (!value) return { defaultDate: null, defaultTime: null };
  const timeMatch = value.match(TRAILING_TIME);
  const datePart = timeMatch ? value.slice(0, timeMatch.index) : value;
  const defaultDate = parseSeasonDate(datePart, { defaultYear, after });
  const defaultTime = timeMatch ? parseSeasonTime(timeMatch[1]) : null;
  if (!defaultDate || (timeMatch && !defaultTime)) return null;
  return { defaultDate, defaultTime };
}

// One round per line: `Round name | start - end | default date and time (optional)`.
// Blank lines and lines starting with # are ignored. Nothing is saved when any line has an error.
export function parseRoundsText(text, season) {
  const startYear = Number(String(season?.startDate || '').slice(0, 4)) || new Date().getUTCFullYear();
  const seasonStart = season?.startDate || null;
  const rounds = [];
  const errors = [];
  const warnings = [];
  const seen = new Map();
  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;
    const label = `Line ${index + 1}`;
    const columns = line.split('|').map((part) => part.trim());
    if (columns.length < 2 || columns.length > 3) {
      errors.push(`${label}: use \`Round name | start - end | default time\` (the default time is optional).`);
      return;
    }
    const [name, rangeText, defaultText = ''] = columns;
    if (!name) {
      errors.push(`${label}: the round name is missing.`);
      return;
    }
    if (name.length > MAX_ROUND_NAME_LENGTH) {
      errors.push(`${label}: the round name is longer than ${MAX_ROUND_NAME_LENGTH} characters.`);
      return;
    }
    const rangeParts = rangeText.split(RANGE_SPLIT).map((part) => part.trim()).filter(Boolean);
    if (rangeParts.length < 1 || rangeParts.length > 2) {
      errors.push(`${label}: could not read the dates "${rangeText}". Use something like 11/2 - 11/4.`);
      return;
    }
    const startDate = parseSeasonDate(rangeParts[0], { defaultYear: startYear, after: seasonStart });
    const endDate = rangeParts[1]
      ? parseSeasonDate(rangeParts[1], { defaultYear: Number(startDate?.slice(0, 4)) || startYear, after: startDate || seasonStart })
      : startDate;
    if (!startDate || !endDate) {
      errors.push(`${label}: could not read the dates "${rangeText}". Use something like 11/2 - 11/4.`);
      return;
    }
    if (endDate < startDate) {
      errors.push(`${label}: the end date is before the start date.`);
      return;
    }
    const parsedDefault = parseDefault(defaultText, Number(startDate.slice(0, 4)), startDate);
    if (!parsedDefault) {
      errors.push(`${label}: could not read the default "${defaultText}". Use something like 11/3 8:00 PM.`);
      return;
    }
    const key = roundKey(name);
    if (seen.has(key)) {
      errors.push(`${label}: "${name}" is the same round as line ${seen.get(key)}.`);
      return;
    }
    seen.set(key, index + 1);
    const round = { name, startDate, endDate, ...parsedDefault };
    rounds.push(round);
    if (!isKnownRoundName(name)) {
      warnings.push(`"${name}" is not a standard round name, so it only applies when FACEIT uses exactly that name.`);
    }
    if (season?.startDate && (startDate < season.startDate || (season.endDate && endDate > season.endDate))) {
      warnings.push(`"${name}" runs outside the season dates (${formatSeasonRange(season)}).`);
    }
    if (round.defaultDate && (round.defaultDate < startDate || round.defaultDate > endDate)) {
      warnings.push(`"${name}" has a default date outside its own window.`);
    }
  });
  return { rounds, errors, warnings };
}

// The rounds as editable text, the same format parseRoundsText reads.
export function formatRoundsText(season) {
  const year = Number(String(season?.startDate || '').slice(0, 4)) || null;
  return (season?.rounds || []).map((round) => {
    const range = round.startDate === round.endDate
      ? formatShortDate(round.startDate, year)
      : `${formatShortDate(round.startDate, year)} - ${formatShortDate(round.endDate, year)}`;
    const fallback = round.defaultDate
      ? ` | ${formatShortDate(round.defaultDate, year)}${round.defaultTime ? ` ${formatTime12(round.defaultTime)}` : ''}`
      : '';
    return `${round.name} | ${range}${fallback}`;
  }).join('\n');
}

export function formatRoundLine(round) {
  const range = round.startDate === round.endDate
    ? formatShortDate(round.startDate)
    : `${formatShortDate(round.startDate)} – ${formatShortDate(round.endDate)}`;
  const fallback = round.defaultDate
    ? ` · default ${formatShortDate(round.defaultDate)}${round.defaultTime ? ` ${formatTime12(round.defaultTime)} ET` : ''}`
    : '';
  return `**${round.name}**: ${range}${fallback}`;
}

// A round in the shape the scheduling code already uses: long dates that parse with "12:00 AM ET".
export function roundWindowForDisplay(round) {
  if (!round) return null;
  return {
    name: round.name,
    start: formatLongDate(round.startDate),
    end: formatLongDate(round.endDate),
    defaultDate: round.defaultDate ? formatLongDate(round.defaultDate) : null,
    defaultDateTime: round.defaultDate && round.defaultTime
      ? `${formatLongDate(round.defaultDate)} at ${formatTime12(round.defaultTime)} ET`
      : null
  };
}

// The first season round matching any of the names, in the order given.
export function findSeasonRound(season, names) {
  if (!season?.rounds?.length) return null;
  for (const name of names || []) {
    const key = roundKey(name);
    if (!key) continue;
    const round = season.rounds.find((entry) => roundKey(entry.name) === key);
    if (round) return round;
  }
  return null;
}

export function mergeMissingSeasonRounds(season, rounds, { endDate = null } = {}) {
  if (!season) return { season, added: [] };
  const existing = new Set((season.rounds || []).map((round) => roundKey(round.name)));
  const added = (rounds || [])
    .filter((round) => !existing.has(roundKey(round.name)))
    .map((round) => ({ ...round }));
  return {
    season: {
      ...season,
      endDate: endDate && (!season.endDate || season.endDate < endDate) ? endDate : season.endDate,
      rounds: [...(season.rounds || []).map((round) => ({ ...round })), ...added]
    },
    added
  };
}

// ---------- which season ----------

function seasonEnd(season) {
  return season.endDate || OPEN_END;
}

export function seasonContains(season, dateKey) {
  return Boolean(season && dateKey && season.startDate <= dateKey && dateKey <= seasonEnd(season));
}

// The season running today, or the next one to start when none is running (so rooms created
// before a season begins already get its windows). Finished seasons are never current.
export function currentSeason(seasons, todayKey) {
  const list = seasons || [];
  const running = list.find((season) => seasonContains(season, todayKey));
  if (running) return running;
  return list
    .filter((season) => season.startDate > todayKey)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0] || null;
}

export function seasonForDate(seasons, dateKey) {
  return (seasons || []).find((season) => seasonContains(season, dateKey)) || null;
}

export function findSeasonByRef(seasons, ref) {
  const value = String(ref || '').trim().toLowerCase();
  if (!value) return null;
  return (seasons || []).find((season) => season.id === value || season.name.toLowerCase() === value) || null;
}

function overlaps(a, b) {
  return a.startDate <= seasonEnd(b) && b.startDate <= seasonEnd(a);
}

export function validateSeasons(seasons) {
  const names = new Map();
  for (const season of seasons) {
    const name = String(season.name || '').trim();
    if (!name) return 'A season needs a name.';
    if (name.length > MAX_SEASON_NAME_LENGTH) return `Season names can be at most ${MAX_SEASON_NAME_LENGTH} characters.`;
    const lower = name.toLowerCase();
    if (names.has(lower)) return `There is already a season called "${name}".`;
    names.set(lower, season);
    if (!season.startDate) return `${name} needs a start date.`;
    if (season.endDate && season.endDate < season.startDate) return `${name} would end before it starts.`;
  }
  for (let i = 0; i < seasons.length; i += 1) {
    for (let j = i + 1; j < seasons.length; j += 1) {
      if (overlaps(seasons[i], seasons[j])) {
        return `${seasons[i].name} (${formatSeasonRange(seasons[i])}) and ${seasons[j].name} (${formatSeasonRange(seasons[j])}) would overlap.`;
      }
    }
  }
  return null;
}

// Add a season. A running season with no end date that started earlier is closed the day before
// the new one starts, so starting "Season 8" does not require ending "Season 7" first.
export function planStartSeason(seasons, { id, name, startDate, endDate = null, actorId = null, nowIso = new Date().toISOString() }) {
  const next = (seasons || []).map((season) => ({ ...season }));
  const closed = [];
  for (const season of next) {
    if (!season.endDate && season.startDate < startDate) {
      season.endDate = addDays(startDate, -1);
      season.updatedAt = nowIso;
      closed.push(season);
    }
  }
  const season = {
    id,
    name: String(name || '').trim(),
    startDate,
    endDate: endDate || null,
    rounds: [],
    createdBy: actorId,
    createdAt: nowIso,
    updatedAt: nowIso
  };
  next.push(season);
  const error = validateSeasons(next);
  return error ? { error } : { seasons: next, season, closed };
}

export function planUpdateSeason(seasons, id, patch, nowIso = new Date().toISOString()) {
  const next = (seasons || []).map((season) => ({ ...season }));
  const season = next.find((entry) => entry.id === id);
  if (!season) return { error: 'That season no longer exists.' };
  for (const [field, value] of Object.entries(patch)) {
    if (value !== undefined) season[field] = field === 'name' ? String(value).trim() : value;
  }
  season.updatedAt = nowIso;
  const error = validateSeasons(next);
  return error ? { error } : { seasons: next, season };
}

export function planDeleteSeason(seasons, id) {
  const season = (seasons || []).find((entry) => entry.id === id);
  if (!season) return { error: 'That season no longer exists.' };
  return { seasons: seasons.filter((entry) => entry.id !== id), season };
}

export function makeSeasonId(name, seasons = []) {
  const base = `season-${normalizeRoundName(name).replace(/ /g, '-').slice(0, 40) || 'new'}`;
  const taken = new Set((seasons || []).map((season) => season.id));
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
