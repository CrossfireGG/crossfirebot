// Reading the time teams type in `!schedule` / `!reschedule`.

const ZONE_WORDS = 'eastern|est|edt|et|central|cst|cdt|ct|mountain|mst|mdt|mt|pacific|pst|pdt|pt|utc|gmt';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const MONTH_ABBREVIATIONS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec'];
const WEEKDAY_ABBREVIATIONS = ['mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat', 'sun'];
const WORD_ALIASES = {
  tmrw: 'tomorrow', tmr: 'tomorrow', tmrow: 'tomorrow', tomo: 'tomorrow', '2morrow': 'tomorrow', '2mrw': 'tomorrow',
  tonight: 'today', tonite: 'today', tn: 'today',
  wensday: 'wednesday', wendsday: 'wednesday', wednsday: 'wednesday', wedensday: 'wednesday', wendesday: 'wednesday'
};
// Words that are never corrected (so "at", "next", "game" or a zone stay what they are).
const KEEP_WORDS = new Set([
  'at', 'on', 'the', 'this', 'next', 'game', 'time', 'gametime', 'am', 'pm', 'and', 'or', 'of', 'by', 'for',
  'today', 'tomorrow', 'force', 'reason', 'oclock', ...ZONE_WORDS.split('|'), ...MONTHS, ...WEEKDAYS,
  ...MONTH_ABBREVIATIONS, ...WEEKDAY_ABBREVIATIONS
]);

function editDistance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  }
  return rows[a.length][b.length];
}

// A misspelled month or day ("Novemeber", "Thrusday", "wensday") -> the real word, else null.
export function correctDateWord(word) {
  const token = String(word || '').toLowerCase();
  if (WORD_ALIASES[token]) return WORD_ALIASES[token];
  if (token.length < 3 || KEEP_WORDS.has(token)) return null;
  const candidates = [...MONTHS, ...WEEKDAYS, 'today', 'tomorrow'];
  // A longer start of the word ("novem", "wednes", "thursd").
  if (token.length >= 4) {
    const prefixed = candidates.filter((candidate) => candidate.startsWith(token));
    if (prefixed.length === 1) return prefixed[0];
  }
  if (token.length < 5) return null;
  const allowed = token.length >= 8 ? 2 : 1;
  let best = null;
  for (const candidate of candidates) {
    const distance = editDistance(token, candidate);
    if (distance <= allowed && (!best || distance < best.distance)) best = { candidate, distance };
  }
  return best?.candidate || null;
}

// Cleans what was typed so the date and time can be read:
//   "8:30est" -> "8:30 est", "8:30pmest" -> "8:30pm est", "8:30p" -> "8:30pm", "p.m." -> "pm",
//   "9th" -> "9", "Novemeber" -> "november", "Thrusday" -> "thursday", "tmrw" -> "tomorrow".
export function normalizeScheduleText(value) {
  let text = String(value || '')
    .replace(/\b([ap])\.\s?m\.?/gi, '$1m')
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, '$1');
  text = text
    .replace(new RegExp(`(\\d)\\s*(am|pm)(${ZONE_WORDS})\\b`, 'gi'), '$1$2 $3')
    .replace(new RegExp(`(\\d)(${ZONE_WORDS})\\b`, 'gi'), '$1 $2')
    .replace(/(\d)\s?([ap])(?=\s|$|[^a-z.])/gi, '$1$2m');
  text = text.replace(/[A-Za-z0-9]+/g, (word) => {
    if (/\d/.test(word) && !/^2m/i.test(word)) return word;
    return correctDateWord(word) || word;
  });
  return text.replace(/\s+/g, ' ').trim();
}

const MONTH_BEFORE = new RegExp(`\\b(${[...MONTHS, ...MONTH_ABBREVIATIONS].join('|')})\\.?,?\\s*$`, 'i');

// Parses the clock portion of a scheduling command. Evening is the practical
// default for bare 1:00-11:59 times in tournament match rooms.
export function parseScheduleClock(value) {
  const text = normalizeScheduleText(value);
  const explicit = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (explicit) {
    let hour = Number(explicit[1]);
    const minute = Number(explicit[2] || 0);
    const meridiem = explicit[3].toLowerCase();
    if (hour < 1 || hour > 12 || minute > 59) return null;
    if (meridiem === 'pm' && hour !== 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    return { hour, minute, inferredEvening: false };
  }

  // Requiring a colon keeps dates such as "November 6" from being mistaken
  // for a time. Values from 13:00 onward retain normal 24-hour meaning.
  const bare = text.match(/\b(\d{1,2}):(\d{2})(?!\d)/);
  if (bare) {
    let hour = Number(bare[1]);
    const minute = Number(bare[2]);
    if (hour > 23 || minute > 59) return null;
    if (hour >= 1 && hour <= 11) hour += 12;
    return { hour, minute, inferredEvening: true };
  }

  // A bare hour right before a time zone ("Monday 8 EST"), unless it is the day of a month
  // ("November 6 EST") or part of a date ("11/6 EST").
  const zoned = new RegExp(`(?<![\\/\\-\\d:])\\b(\\d{1,2})\\s*(?:o'?clock\\s*)?(?=(?:${ZONE_WORDS})\\b)`, 'gi');
  for (const match of text.matchAll(zoned)) {
    if (MONTH_BEFORE.test(text.slice(0, match.index))) continue;
    let hour = Number(match[1]);
    if (hour < 1 || hour > 12) continue;
    if (hour !== 12) hour += 12;
    return { hour, minute: 0, inferredEvening: true };
  }
  return null;
}
