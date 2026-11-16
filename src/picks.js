// Playoff bracket picks. The website (crossfiregg.com/picks) holds the brackets and scores them;
// the bot only reads its public API and posts to Discord:
//   /picks                 link, lock time and how many brackets are in (top 3 after the lock)
//   lock reminders         24 hours, 3 hours and 30 minutes before the lock
//   "Picks are locked"     once, at the lock
//   info + leaderboard     two plain messages kept (and pinned) in the Picks channel: the info
//                          message with the full scoring, and the top 10, edited in place each
//                          time a result changes anyone's decided picks
//   leader note            one line when first place changes hands
//   champion picks         once, when the bracket is over
// The lock time always comes from the API (it moves if the first match starts earlier).

import { EmbedBuilder, escapeMarkdown } from 'discord.js';

import { getPicksState, savePicksState } from './store.js';

const TICK_MS = 60 * 1000;
const INFO_REFRESH_MS = 10 * 60 * 1000;
// The leaderboard is checked after every finished playoff game: FACEIT is asked every 2 minutes
// how many games are finished, and when that goes up the site is checked every minute until
// the new result shows there (it needs a moment to score it), for at most 20 minutes. A check
// every 30 minutes is kept as a safety net. Without a way to see finished games (or while
// FACEIT can't be read) the site is checked every 10 minutes instead.
const STANDINGS_POLL_MS = 10 * 60 * 1000;
const GAME_WATCH_MS = 2 * 60 * 1000;
const AFTER_GAME_RECHECK_MS = 60 * 1000;
const AFTER_GAME_WINDOW_MS = 20 * 60 * 1000;
const SAFETY_CHECK_MS = 30 * 60 * 1000;
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
    base,
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

// { [userId]: place } for every bracket, in the leaderboard's order.
export function rankMap(entries = []) {
  const ranks = {};
  entries.forEach((entry, index) => {
    if (entry?.userId) ranks[entry.userId] = index + 1;
  });
  return ranks;
}

// " ▲3" / " ▼2" against the places at the last update; nothing when unchanged or not seen before.
export function moverText(previousRanks, userId, rank) {
  const before = Number(previousRanks?.[userId]);
  if (!Number.isInteger(before) || before === rank) return '';
  return before > rank ? ` ▲${before - rank}` : ` ▼${rank - before}`;
}

// The leaderboard's own order is kept: rank is the place in the list. With links, each name
// opens that person's bracket on the site. With previousRanks, movers get ▲n / ▼n.
export function standingsLines(entries = [], limit = 10, { champions = false, links = null, previousRanks = null } = {}) {
  return entries.slice(0, limit).map((entry, index) => {
    const score = entry?.score || {};
    const bracketUrl = links && entry?.userId ? picksLinks(links.base, entry.userId).entry : null;
    const name = `${bracketUrl ? `[${showName(entry?.name)}](<${bracketUrl}>)` : showName(entry?.name)}${moverText(previousRanks, entry?.userId, index + 1)}`;
    const line = `**${index + 1}.** ${name} · **${pointsText(score.total)}** · ${Number(score.correct) || 0}/${Number(score.decided) || 0} correct`;
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

// The standings message: the top 10 (each name opens that bracket) and where to see them all.
// It is edited in place, so the footer and timestamp say when it was last updated.
// ---------- the two messages that sit in the Picks channel (plain messages, not embeds) ----------

// How the site scores a bracket (Season 7). The site does the scoring; this is only shown.
export const PICKS_SCORING_TABLE = [
  'UPPER BRACKET          Winner   Exact score',
  'Round 1 (16 matches)      1         +1',
  'Round 2 (8)               2         +1',
  'Round 3 (4)               4         +2',
  'Round 4 (2)               6         +2',
  'Upper final               8         +4',
  '',
  'LOWER BRACKET          Winner   Exact score',
  'Round 1 (8 matches)       2         +1',
  'Round 2 (8)               4         +2',
  'Round 3 (4)               4         +2',
  'Round 4 (4)               6         +2',
  'Round 5 (2)               6         +2',
  'Round 6 (2)               8         +4',
  'Round 7 (1)               8         +4',
  'Lower final               8         +4',
  '',
  'GRAND FINAL              12         +6'
];

// The info message: what the picks are, where to see them, and the full scoring. Links are in
// <> so Discord shows no preview cards.
export function picksInfoText({ eventName, links, entries = 0 }) {
  return [
    `# 🏆 ${eventName} Bracket Picks`,
    `Picks are locked with **${bracketsInText(entries)}**. The leaderboard below updates by itself as results come in.`,
    `**See every bracket:** <${links.leaderboard}>`,
    '',
    '## How points work',
    'Every match pays for the right winner. Picking the exact map score on top pays a bonus. Later rounds are worth more.',
    '```',
    ...PICKS_SCORING_TABLE,
    '```',
    '**Every winner right:** 212 points · **every winner and every score right:** 318 points',
    '',
    '- Exact score only pays when the winner is right. A wrong winner scores nothing for that match.',
    '- Walkovers pay the winner points but no score bonus.',
    '- A pick on a team that isn\'t actually in that match is wrong once the match is played, so a bad upper-bracket pick also costs you the matches that team would have gone on to play.',
    '- Ties on the leaderboard break by number of correct winners, then name.'
  ].join('\n').slice(0, 2000);
}

// The leaderboard message: the top 10 (each name opens that bracket), movers, and where to see
// them all. It is edited in place, so it says when it was last updated.
export function standingsText({ entries, links, eventName, updatedAt = new Date(), previousRanks = null }) {
  const build = (nameLinks) => {
    const lines = standingsLines(entries, 10, { links: nameLinks ? links : null, previousRanks });
    const moved = lines.some((line) => /[▲▼]\d/.test(line));
    return [
      `## 📊 ${eventName} leaderboard: top ${Math.min(10, entries.length)}`,
      ...lines,
      '',
      `**View all ${entries.length} brackets:** <${links.leaderboard}>`,
      `-# Updated <t:${Math.floor(new Date(updatedAt).getTime() / 1000)}:R> after every result${moved ? ' · ▲▼ = places moved since the last update' : ''}`
    ].join('\n');
  };
  // Ten long names with links can pass Discord's 2000 characters: then the names go unlinked.
  const text = build(true);
  return text.length <= 2000 ? text : build(false).slice(0, 2000);
}

// "👑 New leader: Zoro (14 pts) takes first place from Crown." Plain text, pings nobody.
export function leaderChangeText({ leader, previousName, eventName }) {
  return `👑 **New leader in the ${eventName} bracket picks:** ${showName(leader?.name)} (${pointsText(leader?.score?.total)}) takes first place${previousName ? ` from ${showName(previousName)}` : ''}.`;
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

// finishedGames: async () => how many playoff games are finished (from FACEIT). Optional.
export function createPicks({ client, config, fetchImpl = globalThis.fetch, now = () => Date.now(), finishedGames = null }) {
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
  let gamesAt = 0;
  let gamesFinished = null; // the last count read from FACEIT
  let gamesReadable = false;
  let afterGameUntil = 0;
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

  // The two messages kept in the channel: 'info' (what the picks are and the full scoring) and
  // 'standings' (the top 10). Each is one message, edited in place. A new one is posted (and
  // pinned) when there is none yet, it was deleted, or the channel changed.
  async function keptMessage(state, channel, key) {
    if (!state[`${key}MessageId`] || state[`${key}ChannelId`] !== channel.id) return null;
    try {
      return await channel.messages.fetch(state[`${key}MessageId`]);
    } catch (error) {
      // Only "Unknown Message" means it was deleted. Anything else (Discord hiccup) is retried
      // on the next check, so a second copy is never posted by mistake.
      if (error?.code === 10008) return null;
      throw error;
    }
  }

  async function upsertKept(channel, existing, key, content) {
    const payload = { content, embeds: [], allowedMentions: { parse: [] } };
    if (existing) {
      await existing.edit(payload);
      return { [`${key}MessageId`]: existing.id, [`${key}ChannelId`]: channel.id };
    }
    const message = await channel.send(payload);
    // Pinned so it stays at the top of the channel (needs Manage Messages; skipped if it can't).
    await Promise.resolve(message?.pin?.()).catch((error) => console.warn(`[Picks] could not pin the ${key} message:`, error.message));
    return { [`${key}MessageId`]: message?.id || null, [`${key}ChannelId`]: channel.id };
  }

  // Asks FACEIT how many playoff games are finished. When that goes up, the site is checked
  // every minute for a while (see the constants at the top).
  async function watchGames() {
    if (!finishedGames || now() - gamesAt < GAME_WATCH_MS) return;
    gamesAt = now();
    try {
      const count = Number(await finishedGames());
      if (!Number.isFinite(count)) throw new Error('no count');
      if (gamesFinished !== null && count > gamesFinished) afterGameUntil = now() + AFTER_GAME_WINDOW_MS;
      gamesFinished = count;
      gamesReadable = true;
    } catch (error) {
      // Logged when it starts failing (and the first time, if it never worked), not every 2 minutes.
      if (gamesReadable || gamesFinished === null) console.warn('[Picks] could not read finished games from FACEIT; checking the site every 10 minutes meanwhile:', error.message);
      gamesReadable = false;
      gamesFinished = gamesFinished ?? -1;
    }
  }

  function standingsInterval() {
    if (!gamesReadable) return STANDINGS_POLL_MS;
    return now() < afterGameUntil ? AFTER_GAME_RECHECK_MS : SAFETY_CHECK_MS;
  }

  // Returns true when a new result was on the site (the leaderboard was updated).
  async function checkStandings(state) {
    standingsAt = now();
    const board = await api.getAll();
    if (!board.locked || !board.entries.length) return false;
    const total = decidedTotal(board.entries);
    const seen = state.decidedTotal ?? 0;
    const channel = await announceChannel();
    if (!channel) return false;

    // The info message first, so it sits above the leaderboard. Edited only when its text changes.
    const infoText = picksInfoText({ eventName, links, entries: board.entries.length });
    const info = await keptMessage(state, channel, 'info');
    if (!info || state.infoText !== infoText) {
      await savePicksState(eventId, { ...(await upsertKept(channel, info, 'info', infoText)), infoText });
    }

    // The leaderboard: edited after every result; posted when this channel has none.
    const existing = await keptMessage(state, channel, 'standings');
    if (total !== seen || !existing) {
      // Movers are measured against the places before this result. A re-post with no new
      // result keeps the arrows it had.
      const changed = total !== seen;
      const previousRanks = changed ? (state.ranks || null) : (state.previousRanks || null);
      const content = standingsText({ entries: board.entries, links, eventName, updatedAt: new Date(now()), previousRanks });
      const posted = await upsertKept(channel, existing, 'standings', content);
      const leader = board.entries[0];
      await savePicksState(eventId, {
        decidedTotal: total,
        ...posted,
        ranks: rankMap(board.entries),
        previousRanks,
        leader: { userId: leader?.userId || null, name: leader?.name || null }
      });
      // First place changed hands: a short note (no ping).
      if (changed && state.leader?.userId && leader?.userId && state.leader.userId !== leader.userId) {
        await channel.send({ content: leaderChangeText({ leader, previousName: state.leader.name, eventName }), allowedMentions: { parse: [] } })
          .catch((error) => console.warn('[Picks] leader note failed:', error.message));
      }
    }
    if (bracketComplete(board.entries, config.picksTotalMatches)) {
      if (!(await post(championsEmbed({ entries: board.entries, links, eventName })))) return total !== seen;
      await savePicksState(eventId, { finalPostedAt: new Date(now()).toISOString() });
    }
    return total !== seen;
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

      await watchGames();
      if (now() - standingsAt >= standingsInterval()) {
        // The finished game's result is on the site: back to waiting for the next game.
        if (await checkStandings(state)) afterGameUntil = 0;
      }
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
