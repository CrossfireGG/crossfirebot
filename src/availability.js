// Production and admin crew availability, read from the "CF Game and Staff Schedule" sheet
// (the PROD SCHEDULE and Admin Schedule tabs). The Apps Script sends each tab's cell text and
// background colours; everything below turns that into "who is free for a 9:30 PM match".
//
// How the tabs are laid out (and what this reads):
//   - A header row with dates across the top ("Monday 11/09/2026"); names down the column to the
//     left of the first date. A tab can hold several week blocks, each with its own header row.
//   - Day cells are coloured with the legend on the tab itself ("Can Work", "Could Work",
//     "Cant Work", "Free for partial a day?"). The legend's colours are read from the sheet, so
//     changing a colour there just works. Text in a cell refines it: "8:00PM START" (latest start),
//     "After 7 EST", "7-8 EST//After 9:30EST", "7-9 EST Team Prac" (busy then), "Austin LAN" (busy).
//   - Name cells are coloured with the role legend ("PRODUCER ONLY", "PLAY BY PLAY", "COLOR",
//     "OBSERVER ONLY", "Match Admin", "SMM Admin", "Match & SMM Admin"). No role colour means any
//     production role on the PROD tab, or Admin on an admin tab.
// All times are Eastern; "CST"/"PST"/"MST" in a cell are converted.

export const AVAILABILITY_TIME_ZONE = 'America/New_York';
export const CREW_ROLES = ['caster', 'producer', 'observer', 'admin', 'social'];
export const CREW_ROLE_LABELS = {
  caster: 'Casters',
  producer: 'Producers',
  observer: 'Observers',
  admin: 'Admins',
  social: 'Social Media'
};
// The crew form's fields and the `/cf mainstream` options, mapped to sheet roles.
export const CREW_FIELD_ROLES = {
  casters: 'caster',
  caster1: 'caster',
  caster2: 'caster',
  producer: 'producer',
  observer: 'observer',
  admin: 'admin',
  social: 'social'
};

const DAY_MINUTES = 24 * 60;
// "All day" runs until 4 AM the next morning, so a late match still counts.
const ALL_DAY = [0, DAY_MINUTES + 4 * 60];

const STATUS_LEGEND = [
  [/^(cant|can't|cannot|can not) work/, 'busy'],
  [/^can work/, 'free'],
  [/^could work/, 'maybe'],
  [/^free for (a )?partial/, 'partial']
];
const ROLE_LEGEND = [
  [/^producer( only)?$/, ['producer']],
  [/^play by play$/, ['caster']],
  [/^colou?r$/, ['caster']],
  [/^observer( only)?$/, ['observer']],
  [/^match (&|and) smm admin$/, ['admin', 'social']],
  [/^smm admin$/, ['social']],
  [/^match admin$/, ['admin']]
];

const BUSY_WORDS = /\b(prac|practice|scrims?|busy|working|lan|class|exam|can'?t|cannot|unavailable|out|away|no)\b/i;
const FREE_WORDS = /^(all|all day|all night|any|anytime|any time|free|yes|y|open|whenever|available|✓|✔|✅)$/i;
const MAYBE_WORDS = /\b(maybe|possibly|tbd|unsure|not sure)\b|\?$/i;
// "(?<=\d)" also catches a zone written straight after a time, e.g. "9:30EST".
const ZONE_OFFSETS = [
  [/(?:\b|(?<=\d))(est|edt|et|eastern)\b/gi, 0],
  [/(?:\b|(?<=\d))(cst|cdt|ct|central)\b/gi, 60],
  [/(?:\b|(?<=\d))(mst|mdt|mt|mountain)\b/gi, 120],
  [/(?:\b|(?<=\d))(pst|pdt|pt|pacific)\b/gi, 180]
];

function normalizeLabel(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[?!:.]+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCrewName(name) {
  return String(name || '').toLowerCase().replace(/[\s​]+/g, '').trim();
}

// ---------- colours ----------

function parseHex(color) {
  const match = String(color || '').trim().toLowerCase().match(/^#?([0-9a-f]{6})$/);
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function isBlankColor(color) {
  const rgb = parseHex(color);
  if (!rgb) return true;
  return rgb.every((channel) => channel >= 245);
}

function colorDistance(a, b) {
  const [x, y] = [parseHex(a), parseHex(b)];
  if (!x || !y) return Infinity;
  return Math.sqrt((x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2);
}

// Without a legend: any green is free, yellow maybe, red busy.
export function statusFromHue(color) {
  const rgb = parseHex(color);
  if (!rgb || isBlankColor(color)) return null;
  const [r, g, b] = rgb.map((channel) => channel / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta < 0.12) return null;
  let hue;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue >= 75 && hue <= 170) return 'free';
  if (hue >= 45 && hue < 75) return 'maybe';
  if (hue < 20 || hue >= 330) return 'busy';
  return null;
}

// Nearest legend colour (exact or close), so a slightly different shade still matches.
function nearestLegend(color, entries, maxDistance = 48) {
  if (isBlankColor(color)) return null;
  let best = null;
  for (const entry of entries) {
    const distance = colorDistance(color, entry.color);
    if (distance <= maxDistance && (!best || distance < best.distance)) best = { ...entry, distance };
  }
  return best;
}

export function readLegend(values = [], backgrounds = []) {
  const statuses = [];
  const roles = [];
  values.forEach((row, r) => (row || []).forEach((text, c) => {
    const label = normalizeLabel(text);
    if (!label || label.length > 40) return;
    const color = backgrounds?.[r]?.[c];
    if (isBlankColor(color)) return;
    const status = STATUS_LEGEND.find(([pattern]) => pattern.test(label));
    if (status) statuses.push({ color: String(color).toLowerCase(), status: status[1] });
    const role = ROLE_LEGEND.find(([pattern]) => pattern.test(label));
    if (role) roles.push({ color: String(color).toLowerCase(), roles: role[1] });
  }));
  return { statuses, roles };
}

function cellStatusColor(color, legend) {
  const match = nearestLegend(color, legend.statuses);
  if (match) return match.status;
  return legend.statuses.length ? null : statusFromHue(color);
}

// ---------- dates ----------

const pad = (value) => String(value).padStart(2, '0');

export function addDaysToKey(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

// 0 = Monday ... 6 = Sunday
export function weekdayIndex(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

export function weekKeys(mondayKey) {
  return Array.from({ length: 7 }, (_, index) => addDaysToKey(mondayKey, index));
}

export function mondayOf(dateKey) {
  return addDaysToKey(dateKey, -weekdayIndex(dateKey));
}

// "Monday 11/09/2026", "11/9", "Mon 11/9/26" -> "2026-11-09"
export function parseHeaderDate(text, referenceYear = new Date().getUTCFullYear()) {
  const value = String(text || '').trim();
  if (!value || value.length > 40) return null;
  const match = value.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s|$)/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  let year = match[3] ? Number(match[3]) : referenceYear;
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

// Eastern wall-clock parts of an instant.
export function easternParts(ms, timeZone = AVAILABILITY_TIME_ZONE) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

// The sheet day and minutes a match falls in. Just after midnight counts as the night before.
export function sheetSlotFor(ms) {
  const { dateKey, minutes } = easternParts(ms);
  if (minutes < 4 * 60) return { dateKey: addDaysToKey(dateKey, -1), minutes: minutes + DAY_MINUTES };
  return { dateKey, minutes };
}

export function formatMinutes(minutes) {
  const wrapped = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hour = Math.floor(wrapped / 60);
  const minute = wrapped % 60;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}${minute ? `:${pad(minute)}` : ''} ${suffix}`;
}

// ---------- cell text ----------

const TIME = String.raw`(\d{1,2})(?::(\d{2}))?\s*(a\.?m?\.?|p\.?m?\.?)?`;

function toMinutes(hourText, minuteText, suffixText, { role = 'start', inherit = null } = {}) {
  let hour = Number(hourText);
  const minute = Number(minuteText || 0);
  if (hour > 24 || minute > 59) return null;
  const suffix = suffixText ? (suffixText[0].toLowerCase() === 'a' ? 'am' : 'pm') : inherit;
  if (suffix === 'am') {
    if (hour === 12) hour = role === 'start' ? 0 : 24;
    else if (hour < 5) hour += 24; // 1 AM = after midnight, same night
  } else if (suffix === 'pm') {
    if (hour !== 12) hour += 12;
  } else if (hour >= 1 && hour <= 11) {
    hour += 12; // league nights: a bare "7" means 7 PM
  } else if (hour === 12) {
    hour = role === 'start' ? 12 : 24;
  }
  return hour * 60 + minute;
}

function zoneOffset(text) {
  let offset = 0;
  let cleaned = text;
  for (const [pattern, minutes] of ZONE_OFFSETS) {
    if (pattern.test(cleaned)) offset = minutes;
    pattern.lastIndex = 0;
    cleaned = cleaned.replace(pattern, ' ');
  }
  return { offset, cleaned };
}

// Reads the times written in a cell. Returns windows (free between), latestStart, and whether the
// text says busy ("Team Prac", "LAN").
export function parseCellTimes(rawText) {
  const text = String(rawText || '').toLowerCase().replace(/[–—]/g, '-');
  const { offset, cleaned } = zoneOffset(text);
  const windows = [];
  let latestStart = null;
  const segments = cleaned
    .replace(/\b(?:or|and)\s+later\b/g, 'onwards')
    .replace(new RegExp(`${TIME}\\s*\\+`, 'g'), 'after $&')
    .replace(/\+/g, ' ')
    .split(/\/\/|\/(?!\d)|,|;|&|\band\b|\bor\b|\n/);
  for (const segment of segments) {
    const part = segment.trim();
    if (!part) continue;
    let match = part.match(new RegExp(`^(?:after|from|starting|start(?:ing)? at|available after)\\s+${TIME}`));
    if (match) {
      windows.push([toMinutes(match[1], match[2], match[3]), ALL_DAY[1]]);
      continue;
    }
    // "9:30 EST Earliest", "8 or later", "earliest 9": free from then on.
    match = part.match(new RegExp(`^${TIME}\\s*(?:earliest|or\\s+later|and\\s+later|onwards?|on)$`)) || part.match(new RegExp(`^earliest\\s+${TIME}$`));
    if (match) {
      windows.push([toMinutes(match[1], match[2], match[3]), ALL_DAY[1]]);
      continue;
    }
    match = part.match(new RegExp(`^(?:before|until|till|til|by|up to)\\s+${TIME}`));
    if (match) {
      windows.push([0, toMinutes(match[1], match[2], match[3], { role: 'end' })]);
      continue;
    }
    match = part.match(new RegExp(`${TIME}\\s*(?:-|to)\\s*${TIME}`));
    if (match) {
      const endSuffix = match[6] ? (match[6][0] === 'a' ? 'am' : 'pm') : null;
      let start = toMinutes(match[1], match[2], match[3], { inherit: endSuffix === 'pm' ? 'pm' : null });
      let end = toMinutes(match[4], match[5], match[6], { role: 'end' });
      if (start === null || end === null) continue;
      if (end <= start) end += DAY_MINUTES;
      if (end - start > DAY_MINUTES) end -= DAY_MINUTES;
      windows.push([start, end]);
      continue;
    }
    match = part.match(new RegExp(`(?:latest\\s+)?(?:start(?:ing)?\\s*(?:at|by)?\\s*)?${TIME}\\s*(?:start|latest)?`));
    if (match && /\d/.test(part) && part.replace(match[0], '').replace(/\b(start|latest|ish|or earlier|at the latest)\b/g, '').trim().length <= 3) {
      latestStart = toMinutes(match[1], match[2], match[3]);
    }
  }
  const shift = (minutes) => (minutes === null ? null : minutes + offset);
  return {
    windows: windows.filter(([start, end]) => start !== null && end !== null).map(([start, end]) => [shift(start), end === ALL_DAY[1] ? end : shift(end)]),
    latestStart: shift(latestStart),
    busyText: BUSY_WORDS.test(cleaned)
  };
}

// One day cell -> what the bot stores: { s: state, w?: windows, b?: busy windows, ls?: latest start, t?: text }
//   s: 'empty' (not filled in), 'free', 'maybe', 'busy', 'windows' (free only in w / up to ls),
//      'busyDuring' (busy in b, otherwise base)
export function parseAvailabilityCell(text, background, legend = { statuses: [], roles: [] }) {
  const value = String(text || '').trim();
  const color = cellStatusColor(background, legend);
  const note = value ? value.slice(0, 60) : undefined;
  if (!value && !color) return { s: 'empty' };
  if (color === 'busy') return { s: 'busy', t: note };
  if (!value) return { s: color === 'partial' ? 'maybe' : color, t: color === 'partial' ? 'partial day, no time given' : undefined };
  const base = color === 'maybe' ? 'maybe' : 'free';
  const times = parseCellTimes(value);
  const hasTimes = times.windows.length || times.latestStart !== null;
  if (times.busyText) {
    if (times.windows.length) return { s: 'busyDuring', b: times.windows, base: color ? base : 'maybe', t: note };
    return { s: 'busy', t: note };
  }
  if (hasTimes) {
    return { s: 'windows', w: times.windows.length ? times.windows : undefined, ls: times.latestStart ?? undefined, base, t: note };
  }
  if (FREE_WORDS.test(value)) return { s: color === 'maybe' ? 'maybe' : 'free', t: note };
  if (MAYBE_WORDS.test(value)) return { s: 'maybe', t: note };
  // Anything else ("FQR vs CLST - CF", a note) follows the colour; with no colour it counts as busy.
  if (color) return { s: color === 'partial' ? 'maybe' : color, t: note };
  return { s: 'busy', t: note };
}

// ---------- tabs ----------

function headerDates(row, referenceYear) {
  const dates = {};
  (row || []).forEach((text, c) => {
    const dateKey = parseHeaderDate(text, referenceYear);
    if (dateKey) dates[c] = dateKey;
  });
  return Object.keys(dates).length >= 3 ? dates : null;
}

function defaultRolesForTab(tabName) {
  return /admin/i.test(tabName || '') ? ['admin'] : ['caster', 'producer', 'observer'];
}

// Parses one tab: { name, values: string[][], backgrounds: string[][] }.
export function parseAvailabilityTab(tab, { referenceYear = new Date().getUTCFullYear() } = {}) {
  const values = tab?.values || [];
  const backgrounds = tab?.backgrounds || [];
  const legend = readLegend(values, backgrounds);
  const people = new Map();
  const dateKeys = new Set();
  let block = null;
  for (let r = 0; r < values.length; r += 1) {
    const dates = headerDates(values[r], referenceYear);
    if (dates) {
      const columns = Object.keys(dates).map(Number);
      block = { dates, nameColumn: Math.max(0, Math.min(...columns) - 1) };
      Object.values(dates).forEach((key) => dateKeys.add(key));
      continue;
    }
    if (!block) continue;
    const name = String(values[r]?.[block.nameColumn] || '').trim();
    if (!name || name.length > 40) continue;
    const key = normalizeCrewName(name);
    const roleMatch = nearestLegend(backgrounds?.[r]?.[block.nameColumn], legend.roles);
    const person = people.get(key) || { key, name, roles: roleMatch ? roleMatch.roles : defaultRolesForTab(tab?.name), days: {} };
    if (roleMatch) person.roles = roleMatch.roles;
    for (const [column, dateKey] of Object.entries(block.dates)) {
      const cell = parseAvailabilityCell(values[r]?.[column], backgrounds?.[r]?.[column], legend);
      if (cell.s !== 'empty' || !person.days[dateKey]) person.days[dateKey] = cell;
    }
    people.set(key, person);
  }
  return {
    name: tab?.name || '',
    legendFound: legend.statuses.length > 0,
    dateKeys: [...dateKeys].sort(),
    people: [...people.values()]
  };
}

// All tabs together. People in two tabs get both tabs' roles; a filled day beats an empty one.
export function parseAvailability(tabs = [], options = {}) {
  const people = new Map();
  const parsedTabs = [];
  for (const tab of tabs) {
    const parsed = parseAvailabilityTab(tab, options);
    parsedTabs.push({ name: parsed.name, dateKeys: parsed.dateKeys, legendFound: parsed.legendFound, people: parsed.people.length });
    for (const person of parsed.people) {
      const existing = people.get(person.key);
      if (!existing) {
        people.set(person.key, { ...person, tabs: [parsed.name] });
        continue;
      }
      existing.roles = [...new Set([...existing.roles, ...person.roles])];
      existing.tabs.push(parsed.name);
      for (const [dateKey, cell] of Object.entries(person.days)) {
        if (!existing.days[dateKey] || existing.days[dateKey].s === 'empty') existing.days[dateKey] = cell;
      }
    }
  }
  return { tabs: parsedTabs, people: [...people.values()] };
}

// ---------- questions ----------

// Is this person free for a match starting at startMs and lasting durationMinutes?
// -> { state: 'free' | 'partial' | 'maybe' | 'busy' | 'unknown', note }
export function availabilityAt(person, startMs, durationMinutes = 180) {
  const { dateKey, minutes: start } = sheetSlotFor(startMs);
  const cell = person?.days?.[dateKey];
  const end = start + durationMinutes;
  if (!cell || cell.s === 'empty') return { state: 'unknown', note: 'not filled in' };
  if (cell.s === 'free') return { state: 'free', note: cell.t || 'free all day' };
  if (cell.s === 'maybe') return { state: 'maybe', note: cell.t || 'could work' };
  if (cell.s === 'busy') return { state: 'busy', note: cell.t || "can't work" };
  if (cell.s === 'busyDuring') {
    for (const [busyStart, busyEnd] of cell.b || []) {
      if (start >= busyStart && start < busyEnd) return { state: 'busy', note: cell.t };
      if (busyStart > start && busyStart < end) return { state: 'partial', note: `has to leave at ${formatMinutes(busyStart)}` };
    }
    return { state: cell.base || 'maybe', note: cell.t };
  }
  // 'windows'
  const base = cell.base || 'free';
  if (cell.ls !== undefined && cell.ls !== null && start <= cell.ls) return { state: base, note: `latest start ${formatMinutes(cell.ls)}` };
  let partial = null;
  for (const [windowStart, windowEnd] of cell.w || []) {
    if (start >= windowStart && end <= windowEnd) return { state: base, note: cell.t };
    if (start >= windowStart && start < windowEnd) partial = { state: 'partial', note: `free until ${formatMinutes(windowEnd)}` };
  }
  return partial || { state: 'busy', note: cell.t || 'not free then' };
}

function formatRange([start, end]) {
  if (end >= ALL_DAY[1]) return `after ${formatMinutes(start)}`;
  if (start <= 0) return `until ${formatMinutes(end)}`;
  return `${formatMinutes(start)}–${formatMinutes(end)}`;
}

// A person's whole day (for "who's free today" with no time):
// -> { state: 'free' | 'partial' | 'maybe' | 'busy' | 'unknown', note }
export function dayAvailability(person, dateKey) {
  const cell = person?.days?.[dateKey];
  if (!cell || cell.s === 'empty') return { state: 'unknown', note: 'not filled in' };
  if (cell.s === 'free') return { state: 'free', note: 'all day' };
  if (cell.s === 'maybe') return { state: 'maybe', note: cell.t || 'could work' };
  if (cell.s === 'busy') return { state: 'busy', note: cell.t || "can't work" };
  if (cell.s === 'busyDuring') return { state: cell.base === 'maybe' ? 'maybe' : 'partial', note: `busy ${(cell.b || []).map(formatRange).join(', ')}` };
  const parts = (cell.w || []).map(formatRange);
  if (cell.ls !== undefined && cell.ls !== null) parts.push(`latest start ${formatMinutes(cell.ls)}`);
  return { state: cell.base === 'maybe' ? 'maybe' : 'partial', note: parts.join(', ') || cell.t || 'part of the day' };
}

const DAY_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// "today", "tomorrow", "Thurs", "11/12", "11/12/2026", "Nov 12" -> "2026-11-12" (null if not a day).
// Expects text already cleaned by normalizeScheduleText (typos fixed).
export function parseDayKey(text, todayKey) {
  const value = String(text || '').trim().toLowerCase();
  if (!value || /^(today|tonight)$/.test(value)) return todayKey;
  if (value === 'tomorrow') return addDaysToKey(todayKey, 1);
  const [year] = todayKey.split('-').map(Number);
  const numeric = value.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/);
  if (numeric) {
    const month = Number(numeric[1]);
    const day = Number(numeric[2]);
    let fullYear = numeric[3] ? Number(numeric[3]) : year;
    if (fullYear < 100) fullYear += 2000;
    return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? `${fullYear}-${pad(month)}-${pad(day)}` : null;
  }
  const named = value.match(/^([a-z]+)\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?$/);
  if (named && DAY_MONTHS.includes(named[1].slice(0, 3))) {
    const month = DAY_MONTHS.indexOf(named[1].slice(0, 3)) + 1;
    const day = Number(named[2]);
    return day >= 1 && day <= 31 ? `${named[3] || year}-${pad(month)}-${pad(day)}` : null;
  }
  const weekday = value.match(/^(?:this\s+|next\s+)?([a-z]+)$/);
  if (weekday && DAY_WEEKDAYS.includes(weekday[1].slice(0, 3))) {
    const wanted = DAY_WEEKDAYS.indexOf(weekday[1].slice(0, 3));
    return addDaysToKey(todayKey, (wanted - weekdayIndex(todayKey) + 7) % 7);
  }
  return null;
}

const STATE_ORDER = { free: 0, partial: 1, maybe: 2, unknown: 3, busy: 4 };

// Everyone with this role, ranked: free first, then partly free, then maybe; fewer matches worked
// this week first within each. `workCount(person)` and `bookedElsewhere(person)` are optional.
export function rankCrewForRole(people, role, startMs, durationMinutes, { workCount = () => 0, bookedElsewhere = () => false } = {}) {
  return people
    .filter((person) => person.roles?.includes(role))
    .map((person) => {
      const booked = bookedElsewhere(person);
      const availability = booked ? { state: 'busy', note: 'on another main stream crew then' } : availabilityAt(person, startMs, durationMinutes);
      return { person, ...availability, worked: workCount(person) || 0 };
    })
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.worked - b.worked || a.person.name.localeCompare(b.person.name));
}

// People who have not filled in any day of the given week (on a tab that has that week).
export function peopleMissingWeek(parsed, mondayKey) {
  const keys = weekKeys(mondayKey);
  const tabsWithWeek = new Set((parsed?.tabs || []).filter((tab) => keys.some((key) => tab.dateKeys.includes(key))).map((tab) => tab.name));
  const missingTabs = (parsed?.tabs || []).filter((tab) => !tabsWithWeek.has(tab.name)).map((tab) => tab.name);
  const people = (parsed?.people || []).filter((person) =>
    (person.tabs || []).some((tab) => tabsWithWeek.has(tab))
    && !keys.some((key) => person.days?.[key] && person.days[key].s !== 'empty'));
  return { people, missingTabs };
}
