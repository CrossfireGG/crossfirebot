import { easternDateKey, seasonContains } from './season.js';

// Request lifecycle. "Active" requests block duplicate submissions and are
// monitored against FACEIT. `approving` and `publish_failed` are approved by
// staff but not yet confirmed by the website, so the caster is not told yet.
export const STREAM_ACTIVE_STATUSES = ['pending', 'approving', 'approved', 'publish_failed'];
export const STREAM_STAFF_ACTION_STATUSES = ['pending', 'publish_failed'];
export const STREAM_STATUS_LABELS = {
  pending: '⏳ Pending review',
  approving: '🔄 Approved - publishing to website…',
  approved: '✅ Approved - live on website',
  publish_failed: '⚠️ Approved - WEBSITE PUBLISH FAILED',
  denied: '❌ Denied',
  revoked: '❌ Approval revoked',
  canceled: '🚫 Canceled',
  withdrawn: '↩️ Withdrawn by caster',
  expired: '⌛ Expired',
  submission_failed: '⚠️ Could not reach staff channel'
};

export const STREAM_HOSTS = {
  'twitch.tv': 'twitch',
  'www.twitch.tv': 'twitch',
  'm.twitch.tv': 'twitch',
  'youtube.com': 'youtube',
  'www.youtube.com': 'youtube',
  'm.youtube.com': 'youtube',
  'youtu.be': 'youtube',
  'kick.com': 'kick',
  'www.kick.com': 'kick'
};
export const SOCIAL_HOSTS = ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'];
const SOCIAL_RESERVED_PATHS = new Set(['home', 'explore', 'i', 'search', 'settings', 'messages', 'notifications', 'login', 'signup']);

export function validateStreamUrl(raw, allowedPlatforms = null) {
  const url = normalizeHttpUrl(raw);
  if (!url) return { valid: false, error: 'Stream link is not a valid URL.' };
  const platform = STREAM_HOSTS[url.hostname.toLowerCase()];
  const allowed = allowedPlatforms?.length ? allowedPlatforms : [...new Set(Object.values(STREAM_HOSTS))];
  if (!platform || !allowed.includes(platform)) {
    return { valid: false, error: `Stream link must be a ${formatPlatformList(allowed)} channel URL.` };
  }
  const pathname = url.pathname.replace(/\/+$/, '');
  if (!pathname.replace(/^\//, '') && !url.searchParams.has('v')) {
    return { valid: false, error: 'Stream link must point to your channel, not just the site homepage.' };
  }
  return { valid: true, value: url.toString(), platform };
}

export function validateSocialUrl(raw) {
  const url = normalizeHttpUrl(raw);
  if (!url) return { valid: false, error: 'X / Twitter link is not a valid URL.' };
  if (!SOCIAL_HOSTS.includes(url.hostname.toLowerCase())) {
    return { valid: false, error: 'X / Twitter link must be an x.com or twitter.com URL.' };
  }
  const handle = url.pathname.replace(/^\/+/, '').split('/')[0];
  if (!handle || SOCIAL_RESERVED_PATHS.has(handle.toLowerCase())) {
    return { valid: false, error: 'X / Twitter link must be your profile, for example `https://x.com/yourhandle`.' };
  }
  return { valid: true, value: url.toString() };
}

export function validateDenialReason(raw, { min = 5, max = 400 } = {}) {
  const text = String(raw || '').trim();
  if (text.length < min) return { valid: false, error: `Denial reason must be at least ${min} characters; it is shown to the caster.` };
  if (text.length > max) return { valid: false, error: `Denial reason must be ${max} characters or fewer.` };
  return { valid: true, value: text };
}

export function validateStreamRequest(input) {
  const errors = [];
  const matchup = String(input.matchup || '').trim();
  const dateTime = String(input.dateTime || '').trim();
  const stream = validateStreamUrl(input.streamUrl, input.allowedPlatforms);
  const social = validateSocialUrl(input.socialUrl);
  const dateTimeMs = parseEasternDateTime(dateTime, input.now);

  const matchDetailsRequired = input.matchDetailsRequired !== false;
  if (matchDetailsRequired && !matchup) errors.push('Matchup is required.');
  if (matchDetailsRequired && (!dateTime || !Number.isFinite(dateTimeMs))) {
    errors.push('Enter the match date and time in Eastern Time using `ET`, `EDT`, or `EST`, for example `10/12/2026 8:00 PM EDT` or `October 12, 2026 8 PM EST`.');
  }
  if (!stream.valid) errors.push(stream.error);
  if (!social.valid) errors.push(social.error);

  return {
    valid: errors.length === 0,
    errors,
    value: {
      matchup,
      dateTime,
      dateTimeIso: Number.isFinite(dateTimeMs) ? new Date(dateTimeMs).toISOString() : null,
      streamUrl: stream.valid ? stream.value : '',
      streamPlatform: stream.valid ? stream.platform : null,
      socialUrl: social.valid ? social.value : ''
    }
  };
}

// Discord renders <t:unix:F> in each viewer's own time zone.
export function discordTimestamp(value, style = 'F') {
  const ms = Date.parse(value || '');
  if (!Number.isFinite(ms)) return null;
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

export function formatScheduleForDiscord(value, fallback = 'Not scheduled on FACEIT yet') {
  const absolute = discordTimestamp(value, 'F');
  if (!absolute) return fallback;
  return `${absolute} (${discordTimestamp(value, 'R')}) · ${formatEasternDateTimeInput(value)}`;
}

function formatPlatformList(platforms) {
  const names = platforms.map((platform) => ({ twitch: 'twitch.tv', youtube: 'youtube.com', kick: 'kick.com' }[platform] || platform));
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
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

// Approved (or approved-but-unpublished) requests are "casts": pulling out of one is a
// withdrawal that staff must hear about. Anything earlier is a plain cancel.
export const STREAM_WITHDRAWABLE_STATUSES = ['approved', 'publish_failed'];
export const LATE_WITHDRAWAL_HOURS = 24;
export const MAX_WITHDRAWAL_REASON_LENGTH = 500;

export function classifyCasterExit(request, now = new Date()) {
  if (!request || !STREAM_ACTIVE_STATUSES.includes(request.status)) return null;
  if (!STREAM_WITHDRAWABLE_STATUSES.includes(request.status)) return { kind: 'cancel', late: false, hoursUntilMatch: null };
  const scheduleIso = request.faceitScheduledAtIso || request.dateTimeIso || null;
  const scheduleMs = scheduleIso ? Date.parse(scheduleIso) : NaN;
  if (!Number.isFinite(scheduleMs)) return { kind: 'withdraw', late: false, hoursUntilMatch: null };
  const hoursUntilMatch = (scheduleMs - now.getTime()) / 3_600_000;
  return { kind: 'withdraw', late: hoursUntilMatch < LATE_WITHDRAWAL_HOURS, hoursUntilMatch };
}

export function normalizeWithdrawalReason(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'No reason given';
  return text.length > MAX_WITHDRAWAL_REASON_LENGTH ? `${text.slice(0, MAX_WITHDRAWAL_REASON_LENGTH - 1)}…` : text;
}

// The post-cast form link for one cast, with the Request ID question pre-filled when the
// configured prefill URL has a {requestId} placeholder.
export function postCastFormLink(prefillUrl, fallbackUrl, requestId) {
  if (prefillUrl && requestId && prefillUrl.includes('{requestId}')) {
    return prefillUrl.replace('{requestId}', encodeURIComponent(String(requestId)));
  }
  return fallbackUrl || prefillUrl || '';
}

// The caster's most recent finished cast (reminder sent) that still has no form response.
// Casts finished before `since` are ignored. Returns null when nothing is outstanding.
export function findOutstandingPostCast(requests, { requesterId, since = null } = {}) {
  const sinceMs = since ? Date.parse(since) : NaN;
  const finished = (requests || [])
    .filter((request) =>
      request.requesterId === requesterId
      && request.status === 'approved'
      && request.postCastReminderSentAt
      && (!Number.isFinite(sinceMs) || Date.parse(request.postCastReminderSentAt) >= sinceMs))
    .sort((a, b) => Date.parse(b.postCastReminderSentAt) - Date.parse(a.postCastReminderSentAt));
  const latest = finished[0];
  if (!latest || latest.postCastFormSubmittedAt || latest.postCastFormWaivedAt) return null;
  return latest;
}

export function classifyFaceitScheduleChange(previousIso, nextIso) {
  if (!previousIso && nextIso) return 'scheduled';
  if (previousIso && !nextIso) return 'unscheduled';
  if (previousIso && nextIso && previousIso !== nextIso) return 'rescheduled';
  return 'unchanged';
}

// One request per caster: the casters who asked to cover this match are the only people told it moved.
export function selectScheduleChangeRecipients(requests) {
  const byCaster = new Map();
  for (const request of requests || []) {
    if (!request?.requesterId || !STREAM_ACTIVE_STATUSES.includes(request.status)) continue;
    const existing = byCaster.get(request.requesterId);
    if (!existing || (existing.status !== 'approved' && request.status === 'approved')) byCaster.set(request.requesterId, request);
  }
  return [...byCaster.values()];
}

export function buildScheduleChangeNotice({ scheduleChange, matchup, status, previousLabel, nextLabel }) {
  const updated = status === 'approved'
    ? 'Your approved stream request has been updated automatically.'
    : 'Your stream request has been updated to match.';
  if (scheduleChange === 'scheduled') return `FACEIT scheduled **${matchup}** for **${nextLabel}**. ${updated}`;
  if (scheduleChange === 'unscheduled') return `FACEIT removed the scheduled time for **${matchup}**. I will notify you when a new time is posted.`;
  return `**${matchup}** moved from **${previousLabel}** to **${nextLabel}**. ${updated}`;
}

export function isTerminalFaceitStatus(status) {
  return /finished|completed|done|canceled|cancelled/.test(String(status || '').toLowerCase());
}

export function isCanceledFaceitStatus(status) {
  return /canceled|cancelled/.test(String(status || '').toLowerCase());
}

export function validateStreamDelivery(type, value) {
  const text = String(value || '').trim();
  if (type === 'custom' || type === 'cstv') {
    return text && text.length <= 1500
      ? { valid: true, value: text }
      : { valid: false, error: 'Enter the connection details or instructions to DM, up to 1500 characters.' };
  }
  if (type === 'twitch') {
    const url = normalizeHttpUrl(text);
    return url && isAllowedHost(url, ['twitch.tv', 'www.twitch.tv'])
      ? { valid: true, value: url.toString() }
      : { valid: false, error: 'Enter a valid twitch.tv stream link.' };
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
  let text = String(value || '').trim();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return null;
    url.protocol = 'https:';
    url.hostname = url.hostname.toLowerCase();
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function isAllowedHost(url, hosts) {
  return hosts.includes(url.hostname.toLowerCase());
}

// Channel name from a stream link, e.g. "twitch.tv/spawned_in" -> "spawned_in",
// "youtube.com/@caster" -> "@caster". Returns null for links that are not a
// channel page (search, directory, single videos), so callers can fall back.
const STREAM_NON_CHANNEL_PATHS = new Set([
  'search', 'directory', 'videos', 'settings', 'p', 'downloads', 'jobs', 'turbo',
  'subscriptions', 'inventory', 'wallet', 'friends', 'messages', 'moderator', 'u',
  'watch', 'results', 'feed', 'shorts', 'live', 'categories', 'following', 'browse'
]);

export function streamChannelName(streamUrl) {
  let url;
  try {
    url = new URL(String(streamUrl || ''));
  } catch {
    return null;
  }
  const platform = STREAM_HOSTS[url.hostname.toLowerCase()];
  if (!platform) return null;
  const segments = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  if (!segments.length) return null;
  if (platform === 'youtube') {
    if (segments[0].startsWith('@') && segments[0].length > 1) return segments[0];
    if (['c', 'user'].includes(segments[0].toLowerCase()) && segments[1]) return segments[1];
    return null;
  }
  const name = segments[0];
  if (STREAM_NON_CHANNEL_PATHS.has(name.toLowerCase())) return null;
  return /^[A-Za-z0-9_-]{2,25}$/.test(name) ? name : null;
}

// "You're being covered" notice for the two teams' match channel. Plain data so the
// Discord embed is a thin wrapper and the wording can be tested. The caster is named
// by tag, never mentioned: the teams only need to know who, not be pinged.
export const COVERAGE_COLORS = { active: 0x9b59b6, cancelled: 0x7f8c8d };

export function buildCoverageNotice(request, { cancelled = false, reason = null, remainingCasters = 0 } = {}) {
  const scheduleIso = request?.faceitScheduledAtIso || request?.dateTimeIso || null;
  const matchup = String(request?.matchup || 'this match').trim();
  // Teams see the caster's stream channel name; the Discord tag is only a fallback
  // for links that do not name a channel.
  const caster = String(streamChannelName(request?.streamUrl) || request?.requesterTag || 'a community caster').trim();
  const when = formatScheduleForDiscord(scheduleIso, request?.dateTime || 'Not scheduled on FACEIT yet');

  if (!cancelled) {
    return {
      color: COVERAGE_COLORS.active,
      title: '🎙️ This match will be streamed!',
      description: `**${matchup}** will be casted live by **${caster}**`,
      fields: [
        { name: 'When', value: when, inline: false },
        { name: 'Watch', value: request?.streamUrl || 'Stream link to follow', inline: false },
        request?.faceitUrl ? { name: 'FACEIT Matchroom', value: request.faceitUrl, inline: false } : null
      ].filter(Boolean),
      footer: `Stream request ${request?.id || ''}`.trim(),
      followUp: null
    };
  }

  const others = remainingCasters > 0
    ? `${remainingCasters} other approved caster(s) still have this match.`
    : 'No community caster is covering this match now.';
  return {
    color: COVERAGE_COLORS.cancelled,
    title: `🚫 Community coverage cancelled`,
    description: `**${caster}** is no longer casting **${matchup}**.${reason ? ` ${reason}` : ''}`,
    fields: [
      { name: 'When', value: when, inline: false },
      { name: 'Coverage', value: others, inline: false }
    ],
    footer: `Stream request ${request?.id || ''}`.trim(),
    followUp: `Community coverage of **${matchup}** by **${caster}** was cancelled. ${others}`
  };
}

// Team names from a "Team A vs Team B" matchup string, for channel lookup by name.
export function splitMatchupTeams(matchup) {
  return String(matchup || '').split(/\s+vs\.?\s+/i).map((team) => team.trim()).filter(Boolean).slice(0, 2);
}

// --- "Live now" board ----------------------------------------------------------
// A broadcast is live from the moment the caster presses "Going live" until they
// press "End broadcast", staff/FACEIT end the cast, or the auto-end guard fires.
export const LIVE_AUTO_END_HOURS = 3;
export const LIVE_BOARD_COLOR = 0xe91e63;

export function isBroadcastLive(request) {
  return Boolean(request?.liveStartedAt && !request?.liveEndedAt);
}

// Stale guard: a live broadcast whose FACEIT match ended (or was canceled) more
// than LIVE_AUTO_END_HOURS ago is assumed over even if the caster forgot the button.
export function shouldAutoEndBroadcast(request, now = new Date()) {
  if (!isBroadcastLive(request)) return false;
  if (!['approved'].includes(request.status)) return true;
  const terminalAt = Date.parse(request.terminalNotifiedAt || '');
  if (!Number.isFinite(terminalAt)) return false;
  return now.getTime() - terminalAt >= LIVE_AUTO_END_HOURS * 60 * 60 * 1000;
}

// One board message per broadcast. Plain data; no mentions anywhere.
export function buildLiveBoardNotice(request) {
  const scheduleIso = request?.faceitScheduledAtIso || request?.dateTimeIso || null;
  const caster = String(request?.requesterTag || 'Community caster').trim();
  const platform = request?.streamPlatform ? ` (${request.streamPlatform})` : '';
  return {
    color: LIVE_BOARD_COLOR,
    title: `🔴 LIVE: ${String(request?.matchup || 'CROSSFIRE').trim()}`,
    description: `**${caster}** is broadcasting now.`,
    fields: [
      { name: `Watch${platform}`, value: request?.streamUrl || 'Stream link to follow', inline: false },
      { name: 'Match', value: formatScheduleForDiscord(scheduleIso, request?.dateTime || 'Not scheduled on FACEIT yet'), inline: true },
      { name: 'Started', value: request?.liveStartedAt ? discordTimestamp(request.liveStartedAt, 'R') : 'just now', inline: true },
      request?.faceitUrl ? { name: 'FACEIT Matchroom', value: request.faceitUrl, inline: false } : null
    ].filter(Boolean),
    footer: `Stream request ${request?.id || ''}`.trim()
  };
}

// --- Main stream (official broadcast) -------------------------------------------
// "!request mainstream <link>", "!request main stream", "!request main-stream",
// "!request main". Returns the text after the keyword, or null when the message is
// anything else ("!request" alone, or "!request maintenance"), which is pointed at /request stream.
export function parseMainStreamCommand(content) {
  const match = String(content || '').trim().match(/^!request\s+main(?:\s*-?\s*stream)?(?=\s|$)([\s\S]*)$/i);
  return match ? { rest: match[1].trim() } : null;
}

// Plain-text post for #request-ip so whoever needs it can copy the command.
// Every IP staff enter is posted; main-stream matches are flagged as such.
export function buildRequestIpMessage({ matchup, faceitUrl, value, enteredBy = null, mainStream = false, casterCount = 0, delivered = 0 }) {
  const text = String(value || '').trim();
  const detail = /\n/.test(text) ? text : `\`${text.replace(/`/g, '')}\``;
  const label = String(matchup || 'FACEIT match').trim();
  const sentTo = [
    mainStream ? 'main stream' : null,
    casterCount > 0 ? `DMed to ${delivered}/${casterCount} approved caster(s)` : null
  ].filter(Boolean).join(' · ');
  return [
    mainStream ? `📺 **MAIN STREAM: ${label}**` : `🔌 **IP: ${label}**`,
    detail,
    faceitUrl ? `FACEIT: <${faceitUrl}>` : null,
    [enteredBy ? `Entered by <@${enteredBy}>` : null, sentTo || null].filter(Boolean).join(' · ') || null
  ].filter(Boolean).join('\n');
}

// --- Connection details (CSTV connect / IP) -------------------------------------
// Statuses whose caster gets the IP: approved by staff, even if the website publish
// is still failing (that is a website problem, not a reason to leave a caster out).
export const STREAM_CONNECTION_STATUSES = ['approved', 'publish_failed'];

// FACEIT room id for a request: the verified match id, or the room in the link the
// caster submitted when FACEIT could not be reached at submit time.
export function requestRoomId(request) {
  return request?.matchId || parseFaceitMatchRoomLink(request?.faceitUrl)?.matchId || null;
}

// Every caster who should get this match's connection details, one request each.
export function selectConnectionRecipients(requests, matchId) {
  const wanted = String(matchId || '').toLowerCase();
  const matching = (requests || []).filter((request) =>
    wanted && STREAM_CONNECTION_STATUSES.includes(request?.status) && requestRoomId(request) === wanted
  );
  const byCaster = new Map();
  for (const request of matching) {
    const existing = byCaster.get(request.requesterId);
    if (!existing || (existing.status !== 'approved' && request.status === 'approved')) byCaster.set(request.requesterId, request);
  }
  return { requests: matching, recipients: [...byCaster.values()] };
}

export function buildConnectionDm({ matchup, type, value }) {
  const label = type === 'cstv'
    ? 'FACEIT CSTV connect'
    : type === 'twitch' ? 'official CROSSFIRE stream' : 'connection details from Tournament Operations';
  const detail = type === 'cstv' ? `\`${value}\`` : value;
  return `**${matchup}** is ready. ${label}:\n${detail}`;
}

// ---------- `/request mine`: a caster's own casts ----------

export const MY_CASTS_LIMIT = 10;
// A cast whose match time passed this long ago counts as past even if FACEIT never reported it finished.
const MY_CASTS_GRACE_MS = 6 * 60 * 60 * 1000;

export function castTimeIso(request) {
  return request?.faceitScheduledAtIso || request?.dateTimeIso || null;
}

// Approved casts split into upcoming (soonest first) and past (most recent first). Matches FACEIT
// canceled are not casts, so they are left out.
export function splitMyCasts(requests, { requesterId, now = Date.now() } = {}) {
  const upcoming = [];
  const past = [];
  for (const request of requests || []) {
    if (request?.requesterId !== requesterId || !STREAM_CONNECTION_STATUSES.includes(request.status)) continue;
    if (request.terminalNotifiedAt && isCanceledFaceitStatus(request.faceitStatus)) continue;
    const startMs = Date.parse(castTimeIso(request) || '');
    const finished = Boolean(request.postCastReminderSentAt || request.terminalNotifiedAt)
      || (Number.isFinite(startMs) && startMs < now - MY_CASTS_GRACE_MS);
    (finished ? past : upcoming).push(request);
  }
  const startOf = (request) => {
    const ms = Date.parse(castTimeIso(request) || '');
    return Number.isFinite(ms) ? ms : Infinity;
  };
  const finishedOf = (request) => Date.parse(request.postCastReminderSentAt || request.terminalNotifiedAt || castTimeIso(request) || '') || 0;
  upcoming.sort((a, b) => startOf(a) - startOf(b));
  past.sort((a, b) => finishedOf(b) - finishedOf(a));
  return { upcoming, past };
}

// received: the form is in. waived: staff marked it received. missing: the form DM went out and
// nothing came back. not_required: the cast finished without a form DM (before the form existed).
export function postCastFormState(request) {
  if (request?.postCastFormSource === 'staff' || request?.postCastFormWaivedAt) return 'waived';
  if (request?.postCastFormSubmittedAt) return 'received';
  if (request?.postCastReminderSentAt) return 'missing';
  return 'not_required';
}

export function connectionStatusLine(request) {
  if (!request?.deliverySentAt) return '⏳ IP not sent yet. It comes by DM when staff send it.';
  const what = request.deliveryType === 'cstv'
    ? 'CSTV connect'
    : request.deliveryType === 'twitch' ? 'Official stream link' : 'Server IP';
  return request.deliveryStatus === 'failed'
    ? `⚠️ ${what} was sent, but your DMs were closed. Open your DMs and ask staff to resend it.`
    : `✅ ${what} sent to your DMs ${discordTimestamp(request.deliverySentAt, 'R') || ''}`.trim();
}

const FORM_STATE_ICONS = { received: '✅', waived: '☑️', missing: '❌', not_required: '▫️' };
const FORM_STATE_TEXT = {
  received: 'form received',
  waived: 'form marked received by staff',
  missing: 'form missing',
  not_required: 'no form needed'
};

// The `/request mine` reply. `formLink(requestId)` builds the pre-filled form URL.
export function buildMyCastsView(requests, { requesterId, now = Date.now(), formLink = () => '', formCheckFailed = false, limit = MY_CASTS_LIMIT, stats = null } = {}) {
  const { upcoming, past } = splitMyCasts(requests, { requesterId, now });
  if (!upcoming.length && !past.length) {
    return {
      description: 'You have no approved casts yet. Use `/request stream` to ask to cover a match.',
      missingForms: [],
      upcomingCount: 0,
      pastCount: 0
    };
  }
  const lines = [];
  if (stats) lines.push(formatStatsLine(stats), '');
  lines.push('**Upcoming**');
  if (!upcoming.length) lines.push('Nothing scheduled. Use `/request stream` to pick up a match.');
  for (const request of upcoming.slice(0, limit)) {
    const when = discordTimestamp(castTimeIso(request), 'F');
    const room = request.faceitUrl ? ` · [Matchroom](${request.faceitUrl})` : '';
    lines.push(`**${request.matchup || request.id}**${isBroadcastLive(request) ? ' · 🔴 live now' : ''}`);
    lines.push(`${when ? `${when} (${discordTimestamp(castTimeIso(request), 'R')})` : 'Not scheduled on FACEIT yet'}${room}`);
    lines.push(connectionStatusLine(request));
  }
  if (upcoming.length > limit) lines.push(`…and ${upcoming.length - limit} more.`);

  const shownPast = past.slice(0, limit);
  const missingForms = [];
  lines.push('', '**Past casts**');
  if (!past.length) lines.push('None yet.');
  for (const request of shownPast) {
    const state = postCastFormState(request);
    const day = discordTimestamp(castTimeIso(request) || request.postCastReminderSentAt, 'D');
    const url = state === 'missing' ? formLink(request.id) : '';
    if (state === 'missing' && url) missingForms.push({ id: request.id, matchup: request.matchup || request.id, url });
    const hint = state === 'missing' && !url ? ' (ask staff for the form link)' : '';
    lines.push(`${FORM_STATE_ICONS[state]} **${request.matchup || request.id}**${day ? ` · ${day}` : ''} · ${FORM_STATE_TEXT[state]}${hint}`);
  }
  if (past.length > limit) lines.push(`Showing your ${limit} most recent of ${past.length} past casts.`);
  if (missingForms.length) lines.push('', 'Use the buttons below to fill in each missing form. Your request ID is already filled in.');
  if (formCheckFailed) lines.push('', '⚠️ I could not reach the form sheet just now, so a form you sent recently may still show ❌.');
  return { description: lines.join('\n'), missingForms, upcomingCount: upcoming.length, pastCount: past.length };
}

// ---------- personal stats ----------

// Past casts in the season (by match date, Eastern time), or all time when no season is given.
// The form rate counts only casts that got the post-cast form DM; staff-marked forms count as in.
export function computeCasterStats(requests, { requesterId, season = null, now = Date.now() } = {}) {
  const { past } = splitMyCasts(requests, { requesterId, now });
  const inScope = season
    ? past.filter((request) => {
      const ms = Date.parse(castTimeIso(request) || request.postCastReminderSentAt || request.createdAt || '');
      return Number.isFinite(ms) && seasonContains(season, easternDateKey(new Date(ms)));
    })
    : past;
  const formsDue = inScope.filter((request) => request.postCastReminderSentAt);
  const formsIn = formsDue.filter((request) => ['received', 'waived'].includes(postCastFormState(request)));
  return {
    scope: season?.name || 'All time',
    casts: inScope.length,
    formsDue: formsDue.length,
    formsIn: formsIn.length,
    rate: formsDue.length ? Math.round((formsIn.length / formsDue.length) * 100) : null,
    matchups: inScope.map((request) => request.matchup || request.id)
  };
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function formRateText(stats) {
  return stats.rate === null ? 'no forms due yet' : `${stats.rate}% (${stats.formsIn}/${stats.formsDue})`;
}

export function formatStatsLine(stats) {
  return `📊 **${stats.scope}** · ${plural(stats.casts, 'cast')} · forms ${formRateText(stats)}`;
}

// The public card a caster can choose to post with the Share button. No upcoming games,
// connection status or links: only what they chose to show off.
export function buildStatsCard(stats, { userId } = {}) {
  const shown = stats.matchups.slice(0, 10);
  const more = stats.matchups.length - shown.length;
  return {
    title: `🎙️ Casting stats · ${stats.scope}`,
    description: userId ? `<@${userId}>` : null,
    fields: [
      { name: 'Casts', value: String(stats.casts), inline: true },
      { name: 'Post-cast forms', value: stats.rate === null ? 'None due yet' : `${stats.rate}% (${stats.formsIn}/${stats.formsDue})`, inline: true },
      {
        name: 'Matches covered',
        value: shown.length ? [...shown.map((matchup) => `• ${matchup}`), more > 0 ? `…and ${more} more` : null].filter(Boolean).join('\n').slice(0, 1024) : 'None yet',
        inline: false
      }
    ]
  };
}

// ---------- reminders ----------

export const PRE_CAST_REMINDER_MINUTES = 30;
export const POST_CAST_NUDGE_HOURS = 48;
// How long to wait before asking the form sheet again when a nudge check could not run.
export const POST_CAST_NUDGE_RECHECK_MINUTES = 60;

// Due from 30 minutes before game time until the match starts, once per scheduled time (a
// reschedule makes it due again). Casters approved inside that window just got the approval
// DM, so they are skipped.
export function isPreCastReminderDue(request, now = Date.now()) {
  if (!STREAM_CONNECTION_STATUSES.includes(request?.status) || request.terminalNotifiedAt) return false;
  const startIso = castTimeIso(request);
  const startMs = Date.parse(startIso || '');
  if (!Number.isFinite(startMs) || request.preCastReminderFor === startIso) return false;
  const opensAt = startMs - PRE_CAST_REMINDER_MINUTES * 60 * 1000;
  if (now < opensAt || now >= startMs) return false;
  const approvedMs = Date.parse(request.reviewedAt || '');
  return !(Number.isFinite(approvedMs) && approvedMs >= opensAt);
}

export function buildPreCastReminder(request, { coCasters = [], liveBoard = false } = {}) {
  const startIso = castTimeIso(request);
  return [
    `⏰ **${request.matchup || request.id}** starts ${discordTimestamp(startIso, 'R')} (${discordTimestamp(startIso, 't')}).`,
    request.faceitUrl ? `Matchroom: ${request.faceitUrl}` : null,
    connectionStatusLine(request),
    coCasters.length ? `Co-casting with: ${coCasters.join(', ')}` : null,
    liveBoard ? 'When you start streaming, press **Going live** below so you show up on the live board.' : null
  ].filter(Boolean).join('\n');
}

// One nudge, 48 hours after the form DM, while the form is still missing. Casts whose form DM
// went out before `since` are left alone. A failed sheet check is retried an hour later.
export function isPostCastNudgeDue(request, now = Date.now(), { since = null } = {}) {
  if (request?.status !== 'approved' || request.postCastNudgeSentAt) return false;
  if (postCastFormState(request) !== 'missing') return false;
  const sentMs = Date.parse(request.postCastReminderSentAt || '');
  if (!Number.isFinite(sentMs) || now - sentMs < POST_CAST_NUDGE_HOURS * 60 * 60 * 1000) return false;
  const sinceMs = Date.parse(since || '');
  if (Number.isFinite(sinceMs) && sentMs < sinceMs) return false;
  const checkedMs = Date.parse(request.postCastNudgeCheckedAt || '');
  return !(Number.isFinite(checkedMs) && now - checkedMs < POST_CAST_NUDGE_RECHECK_MINUTES * 60 * 1000);
}

export function buildPostCastNudge(request, { formUrl = '', gate = false } = {}) {
  return [
    `📝 Reminder: we still do not have your post-cast stats form for **${request.matchup || request.id}** (request ${request.id}).`,
    formUrl ? `Form, with your request ID already filled in: ${formUrl}` : 'Ask staff for the form link.',
    gate ? 'Your next stream request is blocked until this form is in.' : null,
    'If you already sent it without the request ID, ask staff to mark it received.'
  ].filter(Boolean).join('\n');
}

// ---------- post-cast forms (staff: `/cf forms`) ----------

export const STAFF_NUDGE_COOLDOWN_MINUTES = 60;
const FORMS_MAX_LINES = 40;
const FORMS_MAX_NUDGE_BUTTONS = 25;

// Casts whose form DM went out (on or after `since`) and still have no form, grouped by caster.
// Most missing first, then whoever has waited longest.
export function groupMissingForms(requests, { since = null } = {}) {
  const byCaster = new Map();
  for (const request of selectFormCasts(requests, { since }).missing) {
    if (!byCaster.has(request.requesterId)) {
      byCaster.set(request.requesterId, { requesterId: request.requesterId, requesterTag: request.requesterTag || null, requests: [] });
    }
    byCaster.get(request.requesterId).requests.push(request);
  }
  const oldest = (group) => Math.min(...group.requests.map((request) => Date.parse(request.postCastReminderSentAt) || Infinity));
  const groups = [...byCaster.values()];
  for (const group of groups) {
    group.requests.sort((a, b) => (Date.parse(a.postCastReminderSentAt) || 0) - (Date.parse(b.postCastReminderSentAt) || 0));
  }
  return groups.sort((a, b) => b.requests.length - a.requests.length || oldest(a) - oldest(b));
}

// Every cast that got the post-cast form DM (on or after `since`), split into missing and
// submitted. Newest first.
export function selectFormCasts(requests, { since = null } = {}) {
  const sinceMs = Date.parse(since || '');
  const casts = (requests || []).filter((request) =>
    request?.status === 'approved'
    && request.postCastReminderSentAt
    && !(Number.isFinite(sinceMs) && Date.parse(request.postCastReminderSentAt) < sinceMs))
    .sort((a, b) => Date.parse(b.postCastReminderSentAt) - Date.parse(a.postCastReminderSentAt));
  return {
    missing: casts.filter((request) => postCastFormState(request) === 'missing'),
    submitted: casts.filter((request) => postCastFormState(request) !== 'missing')
  };
}

// The `/cf forms` reply: a count, then one short line per cast (match and caster), missing first.
export function buildFormsOverview({ missing, submitted }, { sheetCheckFailed = false, maxLines = FORMS_MAX_LINES } = {}) {
  if (!missing.length && !submitted.length) return 'No casts have been sent the post-cast form yet.';
  const lines = [`✅ **${submitted.length}** submitted · ❌ **${missing.length}** missing`, ''];
  let budget = maxLines;
  const section = (title, icon, list) => {
    if (!list.length) return;
    lines.push(`**${title}**`);
    const shown = list.slice(0, Math.max(0, budget));
    for (const request of shown) lines.push(`${icon} ${request.matchup || request.id} · <@${request.requesterId}>`);
    budget -= shown.length;
    if (list.length > shown.length) lines.push(`…and ${list.length - shown.length} more`);
    lines.push('');
  };
  section('Missing', '❌', missing);
  section('Submitted', '✅', submitted);
  if (missing.length) lines.push('Press a caster’s button to DM them their missing form links.');
  if (sheetCheckFailed) lines.push('⚠️ The form sheet could not be checked just now, so a form sent recently may still show as missing.');
  let text = lines.join('\n').trim();
  if (text.length > 4096) text = `${text.slice(0, 4060)}\n…list cut short.`;
  return text;
}

// One Nudge button per caster with a missing form, most missing first.
export function formsNudgeCasters(requests, { since = null, max = FORMS_MAX_NUDGE_BUTTONS } = {}) {
  return groupMissingForms(requests, { since })
    .slice(0, max)
    .map((group) => ({ id: group.requesterId, tag: group.requesterTag, count: group.requests.length }));
}

// The DM a staff nudge sends: every missing form for that caster, each with its own pre-filled link.
export function buildStaffFormNudge(requests, { formLink = () => '', gate = false } = {}) {
  const lines = [
    requests.length === 1
      ? '📝 Tournament Operations is still waiting on your post-cast stats form:'
      : `📝 Tournament Operations is still waiting on ${requests.length} post-cast stats forms from you:`
  ];
  for (const request of requests) {
    const url = formLink(request.id);
    lines.push(`- **${request.matchup || request.id}** (request ${request.id})${url ? `: ${url}` : ''}`);
  }
  if (gate) lines.push('Your next stream request is blocked until these are in.');
  lines.push('Each link has your request ID filled in. If you already sent a form without it, ask staff to mark it received.');
  return lines.join('\n');
}

export function staffNudgeCooldownUntil(requests, now = Date.now()) {
  const last = Math.max(...(requests || []).map((request) => Date.parse(request.postCastStaffNudgeAt || '') || 0));
  const until = last + STAFF_NUDGE_COOLDOWN_MINUTES * 60 * 1000;
  return last && until > now ? until : null;
}
