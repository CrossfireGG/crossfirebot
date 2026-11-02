// Parses the clock portion of a scheduling command. Evening is the practical
// default for bare 1:00-11:59 times in tournament match rooms.
export function parseScheduleClock(value) {
  const text = String(value || '');
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
  const bare = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!bare) return null;
  let hour = Number(bare[1]);
  const minute = Number(bare[2]);
  if (hour > 23 || minute > 59) return null;
  if (hour >= 1 && hour <= 11) hour += 12;
  return { hour, minute, inferredEvening: true };
}
