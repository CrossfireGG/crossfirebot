// Playoff bracket picks. The website (crossfiregg.com/picks) holds the brackets and scores them;
// the bot only reads its public API and posts to Discord:
//   /picks                 link, lock time and how many brackets are in (top 3 after the lock)
//   lock reminders         24 hours, 3 hours and 30 minutes before the lock
//   "Picks are locked"     once, at the lock
//   standings              the top 10 each time a result changes anyone's decided picks
//   champion picks         once, when the bracket is over
// The lock time always comes from the API (it moves if the first match starts earlier).

import { EmbedBuilder, escapeMarkdown } from 'discord.js';

import { getPicksState, savePicksState } from './store.js';

const TICK_MS = 60 * 1000;
const INFO_REFRESH_MS = 10 * 60 * 1000;
const STANDINGS_POLL_MS = 10 * 60 * 1000;
// The "locked" post is skipped when the bot first sees the lock this long after it.
const LOCK_POST_GRACE_MS = 6 * 60 * 60 * 1000;
const EMBED_COLOR = 0xff5500;
const MINUTE = 60 * 1000;

// A reminder missed by more than its grace (the bot was down) is skipped, not posted late.
export const PICKS_REMINDERS = [
  { key: '24h', beforeMs: 24 * 60 * MINUTE, graceMs: 60 * MINUTE, label: '24 hours' },
  { key: '3h', beforeMs: 3 * 60 * MINUTE, graceMs: 30 * MINUTE, label: '3 hours' },
  { key: '30m', beforeMs: 30 * MINUTE, graceMs: 10 * MINUTE, label: '30 minutes' }
];

// ---------- pure helpers (tested) ----------

export function picksLinks(baseUrl, userId = null) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  return {
    picks: `${base}/picks`,
    leaderboard: `${base}/picks/leaderboard`,
    entry: userId ? `${base}/picks/${encodeURIComponent(userId)}` : null
  };
}

// The reminder to post now, or null. sent = { [key]: when it was posted }.
export function dueReminder(nowMs, locksAtMs, sent = {}) {
  if (!Number.isFinite(locksAtMs) || nowMs >= locksAtMs) return null;
  for (const reminder of PICKS_REMINDERS) {
    const at = locksAtMs - reminder.beforeMs;
    if (nowMs >= at && nowMs < at + reminder.graceMs && !sent[reminder.key]) return reminder;
  }
  return null;
}

export function bracketsInText(entries) {
  const count = Math.max(0, Number(entries) || 0);
  return `${count} bracket${count === 1 ? '' : 's'} in`;
}

// "Sat, Nov 14 at 8:00 PM ET"
export function lockTimeText(locksAt, timeZone = 'America/New_York') {
  const date = new Date(locksAt);
  if (Number.isNaN(date.getTime())) return 'soon';
  const day = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(date);
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(date);
  return `${day} at ${time} ET`;
}

function discordTime(locksAt, style) {
  const seconds = Math.floor(new Date(locksAt).getTime() / 1000);
  return Number.isFinite(seconds) ? `<t:${seconds}:${style}>` : '';
}

// Every entry's decided picks added up: it changes whenever any entry's score.decided does.
export function decidedTotal(entries = []) {
  return entries.reduce((sum, entry) => sum + (Number(entry?.score?.decided) || 0), 0);
}

// Over when every pick of the fullest bracket is decided (or totalMatches of them, when set).
export function bracketComplete(entries = [], totalMatches = 0) {
  const mostDecided = Math.max(0, ...entries.map((entry) => Number(entry?.score?.decided) || 0));
  const mostPicked = Math.max(0, ...entries.map((entry) => Number(entry?.picked) || 0));
  const needed = totalMatches > 0 ? totalMatches : mostPicked;
  return needed > 0 && mostDecided >= needed;
}

function showName(name) {
  return escapeMarkdown(String(name || 'Unknown').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Unknown');
}

function pointsText(total) {
  const points = Number(total) || 0;
  return `${points} pt${points === 1 ? '' : 's'}`;
}

// The leaderboard's own order is kept: rank is the place in the list.
export function standingsLines(entries = [], limit = 10, { champions = false } = {}) {
  return entries.slice(0, limit).map((entry, index) => {
    const score = entry?.score || {};
    const line = `**${index + 1}.** ${showName(entry?.name)} · **${pointsText(score.total)}** · ${Number(score.correct) || 0}/${Number(score.decided) || 0} correct`;
    return champions ? `${line} · 🏆 ${entry?.champion ? showName(entry.champion) : 'no pick'}` : line;
  });
}

// [{ team, count }] most picked first; ties keep the order they first appear in.
export function championTally(entries = []) {
  const counts = new Map();
  for (const entry of entries) {
    if (!entry?.champion) continue;
    counts.set(entry.champion, (counts.get(entry.champion) || 0) + 1);
  }
  return [...counts].map(([team, count]) => ({ team, count })).sort((a, b) => b.count - a.count);
}

export function reminderEmbed({ reminder, info, links, eventName, timeZone }) {
  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`⏰ Bracket picks lock in ${reminder.label}`)
    .setDescription([
      `Fill in your **${eventName}** bracket before it locks.`,
      `🔒 Locks **${lockTimeText(info.locksAt, timeZone)}** (${discordTime(info.locksAt, 'R')})`,
      `📋 **${bracketsInText(info.entries)}**`,
      `👉 ${links.picks}`
    ].join('\n'));
}

export function lockedEmbed({ info, links, eventName }) {
  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('🔒 Picks are locked')
    .setDescription([
      `**${eventName}** bracket picks are closed with **${bracketsInText(info.entries)}**.`,
      `Follow the standings: ${links.leaderboard}`
    ].join('\n'));
}

export function standingsEmbed({ entries, links, eventName }) {
  const lines = standingsLines(entries, 10);
  const more = entries.length - lines.length;
  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`📊 ${eventName} bracket picks: top ${Math.min(10, entries.length)}`)
    .setDescription([
      ...lines,
      '',
      `${more > 0 ? `…and ${more} more. ` : ''}Full leaderboard: ${links.leaderboard}`
    ].join('\n'));
}

export function championsEmbed({ entries, links, eventName }) {
  const tally = championTally(entries);
  const shown = tally.slice(0, 10).map(({ team, count }) => `${showName(team)}: ${count}`);
  if (tally.length > shown.length) shown.push(`…and ${tally.length - shown.length} more teams`);
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`🏆 ${eventName} bracket picks: final standings`)
    .setDescription([
      'The bracket is complete. Final top 10 and who each picked to win it all:',
      '',
      ...standingsLines(entries, 10, { champions: true }),
      '',
      `Full leaderboard: ${links.leaderboard}`
    ].join('\n'));
  if (shown.length) embed.addFields({ name: `Champion picks (${entries.length} brackets)`, value: shown.join('\n').slice(0, 1024) });
  return embed;
}

// The /picks reply. info = the event (or null when the site can't be reached); entries = the
// leaderboard after the lock (or null).
export function picksCommandText({ info, entries = null, links, eventName, timeZone }) {
  const title = `🏆 **${eventName} bracket picks**`;
  if (!info) return [title, `Make your picks: ${links.picks}`, '_The site did not answer just now, so the lock time and count are missing._'].join('\n');
  if (!info.locked) {
    return [
      title,
      `Make your picks: ${links.picks}`,
      `🔒 Picks lock **${lockTimeText(info.locksAt, timeZone)}** (${discordTime(info.locksAt, 'R')})`,
      `📋 **${bracketsInText(info.entries)}**`
    ].join('\n');
  }
  const top = (entries || []).slice(0, 3).map((entry, index) => `**${index + 1}.** ${showName(entry?.name)} · ${pointsText(entry?.score?.total)}`);
  return [
    title,
    `🔒 Picks are locked (**${bracketsInText(entries ? entries.length : info.entries)}**).`,
    `Leaderboard: ${links.leaderboard}`,
    ...(top.length ? ['', ...top] : [])
  ].join('\n');
}

// ---------- the website ----------

// getInfo() -> the event; getAll() -> { locked: true, entries } or { locked: false, locksAt }
// before the lock. Both throw when the site can't be reached or answers with something else.
export function createPicksApi({ baseUrl, eventId, timeoutMs = 10_000, fetchImpl = globalThis.fetch }) {
  const root = `${String(baseUrl).replace(/\/+$/, '')}/api/picks/${encodeURIComponent(eventId)}`;

  async function get(url) {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'crossfirebot-caster/1' },
      signal: AbortSignal.timeout(timeoutMs)
    });
    const text = await response.text().catch(() => '');
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      // handled below
    }
    return { status: response.status, data, text };
  }

  return {
    async getInfo() {
      const { status, data, text } = await get(root);
      if (status !== 200 || !data || !data.locksAt) throw new Error(`picks info: HTTP ${status} ${text.slice(0, 120)}`);
      return data;
    },
    async getAll() {
      const { status, data, text } = await get(`${root}/all`);
      const code = data?.code || data?.error?.code;
      if (status === 403 && code === 'not_locked') {
        return { locked: false, locksAt: data.locksAt || data.error?.details?.locksAt || null, entries: [] };
      }
      if (status !== 200 || !Array.isArray(data?.entries)) throw new Error(`picks leaderboard: HTTP ${status} ${text.slice(0, 120)}`);
      return { locked: true, locksAt: data.locksAt || null, entries: data.entries };
    }
  };
}

// ---------- the bot side ----------

export function createPicks({ client, config, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
  const eventId = config.picksEventId;
  const eventName = config.picksEventName;
  const timeZone = config.defaultTimezone;
  const links = picksLinks(config.picksBaseUrl);
  const api = createPicksApi({
    baseUrl: config.picksBaseUrl,
    eventId,
    timeoutMs: Math.max(1, Number(config.websiteTimeoutSeconds || 10)) * 1000,
    fetchImpl
  });

  let info = null;
  let infoAt = 0;
  let standingsAt = 0;
  let running = false;
  let timer = null;
  let channelId = config.picksChannelId || null;
  let channelWarned = false;

  async function refreshInfo() {
    info = await api.getInfo();
    infoAt = now();
    return info;
  }

  // PICKS_CHANNEL_ID, or the one channel in the league server named "announcements".
  async function announceChannel() {
    if (!channelId) {
      const guild = await client.guilds.fetch(config.discordGuildId).catch(() => null);
      const channels = guild ? await guild.channels.fetch().catch(() => null) : null;
      const matches = channels
        ? [...channels.values()].filter((channel) => channel?.isTextBased?.() && /^announcements?$/.test(String(channel.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '')))
        : [];
      if (matches.length === 1) channelId = matches[0].id;
    }
    const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
    if (!channel?.isTextBased?.()) {
      if (!channelWarned) console.warn('[Picks] no announcements channel found: set PICKS_CHANNEL_ID. Nothing is posted until then.');
      channelWarned = true;
      return null;
    }
    return channel;
  }

  async function post(embed) {
    const channel = await announceChannel();
    if (!channel) return false;
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    return true;
  }

  async function checkStandings(state) {
    standingsAt = now();
    const board = await api.getAll();
    if (!board.locked || !board.entries.length) return;
    const total = decidedTotal(board.entries);
    const seen = state.decidedTotal ?? 0;
    if (total !== seen) {
      if (!(await post(standingsEmbed({ entries: board.entries, links, eventName })))) return;
      await savePicksState(eventId, { decidedTotal: total });
    }
    if (bracketComplete(board.entries, config.picksTotalMatches)) {
      if (!(await post(championsEmbed({ entries: board.entries, links, eventName })))) return;
      await savePicksState(eventId, { finalPostedAt: new Date(now()).toISOString() });
    }
  }

  // One pass: whatever is due right now gets posted. Runs every minute.
  async function tick() {
    if (!config.picksEnabled || running) return;
    running = true;
    try {
      const state = await getPicksState(eventId);
      if (state.finalPostedAt) return;
      if (!info || now() - infoAt >= INFO_REFRESH_MS) await refreshInfo();
      let locksAtMs = Date.parse(info.locksAt);

      if (!info.locked && now() < locksAtMs) {
        if (!dueReminder(now(), locksAtMs, state.reminders)) return;
        // Read the lock time and the count again right before posting.
        await refreshInfo();
        locksAtMs = Date.parse(info.locksAt);
        const reminder = info.locked ? null : dueReminder(now(), locksAtMs, state.reminders);
        if (!reminder) return;
        if (await post(reminderEmbed({ reminder, info, links, eventName, timeZone }))) {
          await savePicksState(eventId, { reminders: { [reminder.key]: new Date(now()).toISOString() } });
        }
        return;
      }

      if (!state.lockedPostedAt) {
        // The site decides when it is locked; ask again for that and the final count.
        await refreshInfo();
        if (!info.locked) return;
        locksAtMs = Date.parse(info.locksAt);
        const late = now() - locksAtMs > LOCK_POST_GRACE_MS;
        if (late || await post(lockedEmbed({ info, links, eventName }))) {
          await savePicksState(eventId, { lockedPostedAt: late ? 'skipped' : new Date(now()).toISOString() });
        }
      }

      if (now() - standingsAt >= STANDINGS_POLL_MS) await checkStandings(state);
    } finally {
      running = false;
    }
  }

  async function start() {
    if (!config.picksEnabled) {
      console.log('Bracket picks: off (PICKS_ENABLED=false)');
      return;
    }
    try {
      await refreshInfo();
      console.log(`Bracket picks: ${eventId} locks ${info.locksAt} (${bracketsInText(info.entries)})`);
    } catch (error) {
      console.error('[Picks] could not read the website:', error.message);
    }
    await tick().catch((error) => console.error('[Picks] tick failed:', error.message));
    if (!timer) {
      timer = setInterval(() => {
        tick().catch((error) => console.error('[Picks] tick failed:', error.message));
      }, TICK_MS);
      timer.unref?.();
    }
  }

  // /picks
  async function handleCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });
    let current = null;
    let entries = null;
    try {
      current = await refreshInfo();
      if (current.locked) entries = (await api.getAll().catch(() => null))?.entries || null;
    } catch (error) {
      console.warn('[Picks] /picks could not read the website:', error.message);
    }
    await interaction.editReply({
      content: picksCommandText({ info: current, entries, links, eventName, timeZone }),
      allowedMentions: { parse: [] }
    });
  }

  return { start, tick, handleCommand };
}
