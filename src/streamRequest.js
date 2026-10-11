export function validateStreamRequest(input) {
  const errors = [];
  const matchup = String(input.matchup || '').trim();
  const dateTime = String(input.dateTime || '').trim();
  const streamUrl = normalizeHttpUrl(input.streamUrl);
  const socialUrl = normalizeHttpUrl(input.socialUrl);
  const acknowledged = /^(?:yes|y|agree|i agree)$/i.test(String(input.acknowledged || '').trim());
  const dateTimeMs = parseEasternDateTime(dateTime);

  if (!matchup) errors.push('Matchup is required.');
  if (!dateTime || !Number.isFinite(dateTimeMs)) {
    errors.push('Enter the match date and time in Eastern Time, for example `10/12/2026 8:00 PM ET` or `October 12, 2026 8 PM ET`.');
  }
  if (!streamUrl || !isAllowedHost(streamUrl, ['twitch.tv', 'www.twitch.tv'])) errors.push('Stream URL must be a valid twitch.tv link.');
  if (!socialUrl || !isAllowedHost(socialUrl, ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'])) errors.push('Social URL must be a valid x.com or twitter.com link.');
  if (!acknowledged) errors.push('You must acknowledge the configured co-streaming guidelines.');

  return {
    valid: errors.length === 0,
    errors,
    value: {
      matchup,
      dateTime,
      dateTimeIso: errors.some((error) => error.includes('date and time')) ? null : new Date(dateTimeMs).toISOString(),
      streamUrl: streamUrl?.toString() || '',
      socialUrl: socialUrl?.toString() || '',
      acknowledged
    }
  };
}

function parseEasternDateTime(value) {
  const text = String(value || '').trim();
  const normalized = text
    .replace(/\b(EDT|EST|ET|eastern)\b/gi, ' ')
    .replace(/\bat\b/gi, ' ')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const time = normalized.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!time) return Number.NaN;

  const withoutTime = normalized.replace(time[0], ' ').replace(/\s+/g, ' ').trim();
  const parsedDate = Date.parse(`${withoutTime} 12:00 UTC`);
  if (!Number.isFinite(parsedDate)) return Number.NaN;

  let hour = Number(time[1]);
  const minute = Number(time[2] || 0);
  if (hour < 1 || hour > 12 || minute > 59) return Number.NaN;
  if (time[3].toLowerCase() === 'pm' && hour !== 12) hour += 12;
  if (time[3].toLowerCase() === 'am' && hour === 12) hour = 0;

  return zonedTimeToUtc(
    new Date(parsedDate).getUTCFullYear(),
    new Date(parsedDate).getUTCMonth() + 1,
    new Date(parsedDate).getUTCDate(),
    hour,
    minute,
    'America/New_York'
  ).getTime();
}

function zonedTimeToUtc(year, month, day, hour, minute, timeZone) {
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = new Date(target);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(guess);
    const number = (type) => Number(parts.find((part) => part.type === type)?.value);
    const represented = Date.UTC(number('year'), number('month') - 1, number('day'), number('hour'), number('minute'), 0);
    const difference = target - represented;
    if (difference === 0) return guess;
    guess = new Date(guess.getTime() + difference);
  }
  return guess;
}

export function makeStreamRequestId() {
  return `stream-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function makeStreamRequestModalId(requesterId, sourceChannelId) {
  return `stream_request_submit:${requesterId}:${sourceChannelId || 'none'}`;
}

export function parseStreamRequestModalId(customId) {
  const [prefix, requesterId, sourceChannelId] = String(customId || '').split(':');
  if (prefix !== 'stream_request_submit' || !requesterId || !sourceChannelId) return null;
  return { requesterId, sourceChannelId };
}

function normalizeHttpUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function isAllowedHost(url, hosts) {
  return hosts.includes(url.hostname.toLowerCase());
}
