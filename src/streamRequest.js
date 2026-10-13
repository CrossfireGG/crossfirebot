export function validateStreamRequest(input) {
  const errors = [];
  const matchup = String(input.matchup || '').trim();
  const dateTime = String(input.dateTime || '').trim();
  const streamUrl = normalizeHttpUrl(input.streamUrl);
  const socialUrl = normalizeHttpUrl(input.socialUrl);
  const dateTimeMs = parseEasternDateTime(dateTime, input.now);

  const matchDetailsRequired = input.matchDetailsRequired !== false;
  if (matchDetailsRequired && !matchup) errors.push('Matchup is required.');
  if (matchDetailsRequired && (!dateTime || !Number.isFinite(dateTimeMs))) {
    errors.push('Enter the match date and time in Eastern Time using `ET`, `EDT`, or `EST`, for example `10/12/2026 8:00 PM EDT` or `October 12, 2026 8 PM EST`.');
  }
  if (!streamUrl || !isAllowedHost(streamUrl, ['twitch.tv', 'www.twitch.tv'])) errors.push('Stream URL must be a valid twitch.tv link.');
  if (!socialUrl || !isAllowedHost(socialUrl, ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'])) errors.push('Social URL must be a valid x.com or twitter.com link.');

  return {
    valid: errors.length === 0,
    errors,
    value: {
      matchup,
      dateTime,
      dateTimeIso: Number.isFinite(dateTimeMs) ? new Date(dateTimeMs).toISOString() : null,
      streamUrl: streamUrl?.toString() || '',
      socialUrl: socialUrl?.toString() || ''
    }
  };
}

export function parseFaceitMatchRoomLink(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!/(^|\.)faceit\.com$/i.test(url.hostname)) return null;
    const match = decodeURIComponent(url.pathname).match(/\/room\/(1-[0-9a-f-]{36})(?:\/|$)/i);
    if (!match) return null;
    const matchId = match[1].toLowerCase();
    return {
      matchId,
      url: `https://www.faceit.com/en/cs2/room/${matchId}`
    };
  } catch {
    return null;
  }
}

export function validateStreamDelivery(type, value) {
  const text = String(value || '').trim();
  if (type === 'twitch') {
    const url = normalizeHttpUrl(text);
    return url && isAllowedHost(url, ['twitch.tv', 'www.twitch.tv'])
      ? { valid: true, value: url.toString() }
      : { valid: false, error: 'Enter a valid twitch.tv stream link.' };
  }
  if (type === 'cstv') {
    const hasConnect = /^connect\s+/i.test(text);
    const hasAddress = /(?:\d{1,3}\.){3}\d{1,3}:\d{2,5}/.test(text) || /[a-z0-9.-]+:\d{2,5}/i.test(text);
    return hasConnect && hasAddress
      ? { valid: true, value: text }
      : { valid: false, error: 'Enter the complete CSTV command, for example `connect 123.45.67.89:27020`.' };
  }
  return { valid: false, error: 'Unknown delivery type.' };
}

export function parseEasternDateTime(value, now = new Date()) {
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
  const currentDate = datePartsInTimeZone(now, 'America/New_York');
  let parsedDate;
  if (/^today$/i.test(withoutTime)) {
    parsedDate = Date.UTC(currentDate.year, currentDate.month - 1, currentDate.day, 12);
  } else if (/^tomorrow$/i.test(withoutTime)) {
    parsedDate = Date.UTC(currentDate.year, currentDate.month - 1, currentDate.day + 1, 12);
  } else {
    const hasYear = /\b\d{4}\b/.test(withoutTime);
    parsedDate = Date.parse(`${withoutTime}${hasYear ? '' : ` ${currentDate.year}`} 12:00 UTC`);
  }
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

export function formatEasternDateTimeInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value;
  return `${part('month')}/${part('day')}/${part('year')} ${part('hour')}:${part('minute')} ${part('dayPeriod')} ET`;
}

function datePartsInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const number = (type) => Number(parts.find((part) => part.type === type)?.value);
  return { year: number('year'), month: number('month'), day: number('day') };
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
