// Crossfire Arena in Discord, on top of the team voice channels (src/arena.js, which owns the
// FACEIT hub poller and the FACEIT <-> Discord links; this file hooks into both):
//   match record   every Arena match is saved (season, map, score, teams, winner, player stats,
//                  rating changes, voice activity); older matches are loaded from the FACEIT hub
//   match cards    one message per match in arena-games, edited in place from draft to result
//   live board     a pinned message in arena-games: every match drafting or live
//   queue status   a pinned message in arena-games: who is in the Queue voice channel (FACEIT's
//                  API does not say who is in its queue)
//   CF rating      a permanent rating per FACEIT account, with ranks, rank roles and decay
//   leaderboard    a pinned message in arena-data: the hub's season standings with CF rating
//   weekly recap   every Monday in arena-data
//   /arena stats   a player's rating and record
//   staff tools    /arena rating history | adjust | recalc | ban
// Nothing here pings anyone. Rules and text: src/arenaGames.js and src/arenaRating.js.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

import { addDaysToKey, easternParts, mondayOf, weekdayIndex } from './availability.js';
import {
  BOARD_HEADING,
  LEADERBOARD_HEADING,
  QUEUE_HEADING,
  cancelledGame,
  compactGame,
  createGameStore,
  createRatingStore,
  currentSeason,
  historyPageText,
  hubSeasons,
  isFinished,
  latestSeason,
  leaderboardText,
  liveBoardText,
  matchCard,
  playerIdByNickname,
  playerRecord,
  queueText,
  recapText,
  seasonAt,
  statsCard,
  weeklyRecap
} from './arenaGames.js';
import { arenaFaceitUrl, arenaMatchOver, arenaTeams, arenaTeamsLocked, parseFaceitNickname } from './arenaLogic.js';
import { RANKS, RATING_DEFAULTS, assignRanks, decayStatus, expectedWin, rankLevel, rankName, ratingSummary, ratingSummaryText, replayRatings } from './arenaRating.js';
import { prettyMapName } from './matchResult.js';
import { getArenaHubState, listArenaLinks, listArenaMatches, saveArenaHubState } from './store.js';

const TICK_MS = 60 * 1000;
const SEASONS_CACHE_MS = 30 * 60 * 1000;
const LEADERBOARD_EVERY_MS = 10 * 60 * 1000;
const POSITION_CACHE_MS = 5 * 60 * 1000;
const BOARD_DEBOUNCE_MS = 4 * 1000;
// A finished match's stats can take a moment to appear on FACEIT. The rating waits for them
// this long (ADR decides loss protection), then goes ahead without.
const STATS_WAIT_MS = 30 * 60 * 1000;
// Older matches: FACEIT's list stops at 1000, and each match's stats is one more request.
const BACKFILL_PAGE = 50;
const BACKFILL_PER_TICK = 15;
const BACKFILL_MAX_OFFSET = 1000;
const ROLE_CHANGES_PER_TICK = 30;
const HISTORY_PER_PAGE = 10;

// Midnight on a YYYY-MM-DD day in a time zone, as a timestamp.
export function zoneMidnightMs(dateKey, timeZone = 'America/Chicago') {
  const [year, month, day] = dateKey.split('-').map(Number);
  for (let hour = 0; hour <= 14; hour += 1) {
    const ms = Date.UTC(year, month - 1, day, hour);
    const parts = easternParts(ms, timeZone);
    if (parts.dateKey === dateKey && parts.minutes === 0) return ms;
  }
  return Date.UTC(year, month - 1, day, 6);
}

export function createArenaHub({ client, faceit, config, games = createGameStore(), ratingStore = createRatingStore(), isStaff = () => false, now = () => Date.now() }) {
  const hubId = config.arenaHubId;
  const settings = { ...RATING_DEFAULTS, ...(config.arenaRating || {}) };
  const timeZone = config.arenaTimeZone || 'America/Chicago';
  const enabled = () => Boolean(config.arenaEnabled && hubId && config.arenaHubFeatures !== false);
  let seasonsCache = { at: 0, list: [] };
  let hubUrl = null;
  let leaderboardAt = 0;
  let boardTimer = null;
  let lastBoardBody = null;
  let lastQueueBody = null;
  let lastLeaderboardBody = null;
  let drafting = [];
  let backoffUntil = 0;
  let backoffStep = 0;
  let running = false;
  let timer = null;
  // The rating, as last replayed: { players, history, games, ranks, banned }.
  let rating = null;
  const cardSignatures = new Map();
  const positionCache = new Map();
  const warned = new Set();

  function warnOnce(key, message) {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(`[Arena] ${message}`);
  }

  async function seasons() {
    if (seasonsCache.at && now() - seasonsCache.at < SEASONS_CACHE_MS) return seasonsCache.list;
    try {
      const data = await faceit.request(`/leaderboards/hubs/${hubId}?offset=0&limit=50`);
      seasonsCache = { at: now(), list: hubSeasons(data?.items || []) };
    } catch (error) {
      warnOnce('seasons', `could not read the hub's seasons: ${error.message}`);
      seasonsCache = { at: now(), list: seasonsCache.list };
    }
    return seasonsCache.list;
  }

  async function textChannel(id) {
    const channel = id ? await client.channels.fetch(id).catch(() => null) : null;
    if (!channel?.isTextBased?.()) {
      if (id) warnOnce(`channel:${id}`, `can't post in channel ${id} (missing, or the bot can't see it)`);
      return null;
    }
    return channel;
  }

  // A message the bot keeps pinned in a channel and edits in place. After a restart with no
  // record of it, the bot's own pinned message with the same heading is found and reused; a
  // new one is posted (and pinned) only when there is none.
  async function keptUpsert(key, channelId, content, heading) {
    const channel = await textChannel(channelId);
    if (!channel) return false;
    const state = await getArenaHubState();
    const payload = { content, embeds: [], allowedMentions: { parse: [] } };
    let existing = null;
    if (state[`${key}MessageId`] && state[`${key}ChannelId`] === channel.id) {
      try {
        existing = await channel.messages.fetch(state[`${key}MessageId`]);
      } catch (error) {
        if (error?.code !== 10008) throw error; // only "Unknown Message" means it was deleted
      }
    }
    if (!existing && heading && channel.messages.fetchPinned) {
      const pins = await channel.messages.fetchPinned().catch(() => null);
      existing = [...(pins?.values?.() || [])].find((message) => message.author?.id === client.user?.id && String(message.content || '').startsWith(heading)) || null;
      if (existing) await saveArenaHubState({ [`${key}MessageId`]: existing.id, [`${key}ChannelId`]: channel.id });
    }
    if (existing) {
      await existing.edit(payload);
      return true;
    }
    const message = await channel.send(payload);
    await Promise.resolve(message?.pin?.()).catch((error) => console.warn(`[Arena] could not pin the ${key} message: ${error.message}`));
    await saveArenaHubState({ [`${key}MessageId`]: message?.id || null, [`${key}ChannelId`]: channel.id });
    return true;
  }

  // ---------- the rating ----------

  const ratingOf = (playerId) => rating?.players.get(playerId)?.rating ?? settings.startRating;
  const rankOf = (playerId) => rating?.ranks[playerId] || { key: 'unranked', label: `Placing 0/${settings.placementGames}`, placing: true };
  const ratingMaps = () => ({
    ranks: rating?.ranks || {},
    ratings: Object.fromEntries([...(rating?.players.values() || [])].map((player) => [player.id, player.rating]))
  });

  async function bannedSet() {
    const data = await ratingStore.get();
    return new Set([...(config.arenaBannedFaceitIds || []), ...Object.keys(data.banned || {})]);
  }

  // Replays every finished match, the staff adjustments and the decay from the start rating.
  // This is the only way ratings are ever produced, so a live update, the daily decay and a
  // staff recalc all give the same numbers. announce: post rank-ups this replay caused.
  async function recompute({ announce = false } = {}) {
    const all = (await games.all()).filter(isFinished);
    const data = await ratingStore.get();
    const banned = await bannedSet();
    const result = replayRatings(all, data.adjustments, { nowMs: now(), settings });
    const ranks = assignRanks([...result.players.values()], { banned, settings });
    const previous = rating;
    rating = { ...result, ranks, banned };
    const state = await getArenaHubState();
    if (announce && previous && state.backfill?.done) await announceRankUps(previous, rating).catch((error) => console.warn(`[Arena] rank-up post failed: ${error.message}`));
    return rating;
  }

  // "Name just reached Blaze." for anyone who moved up into a higher rank (not a division, and
  // not finishing placement). The first Rank X and the first Rank X 👑 ever get a bigger post.
  async function announceRankUps(before, after) {
    const ups = [];
    for (const player of after.players.values()) {
      const was = before.ranks[player.id]?.key || 'unranked';
      const is = after.ranks[player.id]?.key || 'unranked';
      if (was === 'unranked' || rankLevel(is) <= rankLevel(was)) continue;
      ups.push({ playerId: player.id, nickname: player.nickname || 'A player', rank: rankName(is), key: is });
    }
    if (!ups.length) return;
    const links = await listArenaLinks();
    const firsts = await ratingStore.update((data) => {
      const at = new Date(now()).toISOString();
      data.rankUps.push(...ups.map((entry) => ({ at, playerId: entry.playerId, nickname: entry.nickname, rank: entry.rank })));
      data.rankUps = data.rankUps.slice(-500);
      const first = { rankx: !data.firsts.rankx && ups.some((entry) => entry.key === 'rankx' || entry.key === 'crown'), crown: !data.firsts.crown && ups.some((entry) => entry.key === 'crown') };
      if (first.rankx) data.firsts.rankx = at;
      if (first.crown) data.firsts.crown = at;
      return first;
    });
    const channel = await textChannel(config.arenaDataChannelId);
    if (!channel) return;
    const who = (entry) => `**${entry.nickname}**${links[entry.playerId]?.discordId ? ` (<@${links[entry.playerId].discordId}>)` : ''}`;
    const lines = [];
    for (const entry of ups) {
      const big = (entry.key === 'crown' && firsts.crown) || (['rankx', 'crown'].includes(entry.key) && firsts.rankx);
      lines.push(big
        ? `# 🔥 ${who(entry)} is the first player ever to reach ${entry.rank}!`
        : `🔥 ${who(entry)} just reached **${entry.rank}**.`);
      if (entry.key === 'crown') firsts.crown = false;
      firsts.rankx = false;
    }
    await channel.send({ content: lines.join('\n').slice(0, 2000), allowedMentions: { parse: [] } });
  }

  // ---------- rank roles ----------

  // One role per rank (not per division). Roles with these names are reused; missing ones are
  // made once and their ids remembered.
  async function rankRoles(guild) {
    const state = await getArenaHubState();
    const roles = { ...(config.arenaRankRoleIds || {}), ...(state.rankRoles || {}) };
    if (RANKS.every((rank) => roles[rank.key] && guild.roles.cache?.has?.(roles[rank.key]))) return roles;
    const existing = await guild.roles.fetch().catch(() => null);
    const list = [...(existing?.values?.() || [])];
    for (const rank of RANKS) {
      if (roles[rank.key] && list.some((role) => role.id === roles[rank.key])) continue;
      const found = list.find((role) => role.name === rank.name);
      if (found) {
        roles[rank.key] = found.id;
        continue;
      }
      const made = await guild.roles.create({ name: rank.name, mentionable: false, reason: 'Crossfire Arena rank role' });
      roles[rank.key] = made.id;
      console.log(`[Arena] made the rank role "${rank.name}" (${made.id})`);
    }
    await saveArenaHubState({ rankRoles: roles });
    return roles;
  }

  // Each linked, ranked player holds exactly one rank role (Rank X 👑 holds only that one).
  // Only what changed since last time is touched, a few members per pass.
  async function syncRankRoles() {
    const state = await getArenaHubState();
    if (!rating || !state.backfill?.done) return;
    const channel = await textChannel(config.arenaDataChannelId);
    const guild = channel?.guild || null;
    if (!guild) return;
    const links = await listArenaLinks();
    const wanted = {};
    for (const [playerId, link] of Object.entries(links)) {
      const rank = rating.ranks[playerId];
      if (link?.discordId && rank && !rank.placing) wanted[link.discordId] = rank.key;
    }
    const current = state.rankRoleByDiscord || {};
    const changed = [...new Set([...Object.keys(wanted), ...Object.keys(current)])].filter((discordId) => (wanted[discordId] || null) !== (current[discordId] || null));
    if (!changed.length) return;
    const roles = await rankRoles(guild);
    const roleIds = Object.values(roles);
    const next = { ...current };
    for (const discordId of changed.slice(0, ROLE_CHANGES_PER_TICK)) {
      const member = await guild.members.fetch(discordId).catch(() => null);
      const target = wanted[discordId] ? roles[wanted[discordId]] : null;
      if (member) {
        const has = (roleId) => Boolean(member.roles?.cache?.has?.(roleId));
        const remove = roleIds.filter((roleId) => roleId !== target && (has(roleId) || roleId === roles[current[discordId]]));
        if (remove.length) await member.roles.remove(remove, 'Crossfire Arena rank').catch((error) => warnOnce('role-remove', `could not remove a rank role: ${error.message}`));
        if (target && !has(target)) await member.roles.add(target, 'Crossfire Arena rank').catch((error) => warnOnce('role-add', `could not give a rank role: ${error.message}`));
      }
      if (wanted[discordId]) next[discordId] = wanted[discordId];
      else delete next[discordId];
    }
    await saveArenaHubState({ rankRoleByDiscord: next });
  }

  // ---------- match cards ----------

  function cardPayload(card) {
    const embed = new EmbedBuilder().setTitle(card.title).setColor(card.color);
    if (card.description) embed.setDescription(card.description);
    if (card.fields?.length) embed.addFields(card.fields);
    return { embeds: [embed], allowedMentions: { parse: [] } };
  }

  async function cardMessage(matchId) {
    const state = await getArenaHubState();
    const messageId = state.cards?.[matchId];
    const channel = messageId ? await textChannel(config.arenaGamesChannelId) : null;
    return channel ? channel.messages.fetch(messageId).catch(() => null) : null;
  }

  function liveCard(record, match, links) {
    const teams = match
      ? arenaTeams(match).map((team) => ({ ...team, captain: match.teams?.[team.faction]?.leader || null }))
      : (record.teams || []);
    const teamAvg = teams.map((team) => {
      const values = (team.players || []).map((player) => ratingOf(player.playerId));
      return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : settings.startRating;
    });
    return matchCard({
      stage: 'live',
      number: record.number,
      teams,
      map: prettyMapName(match?.voting?.map?.pick?.[0] || '') || record.map || null,
      server: match?.voting?.location?.pick?.[0] || null,
      url: (match && arenaFaceitUrl(match)) || record.faceitUrl || null,
      status: match?.status || null,
      teamAvg,
      expected: [expectedWin(teamAvg[0], teamAvg[1]), expectedWin(teamAvg[1], teamAvg[0])],
      links,
      placementGames: settings.placementGames,
      ...ratingMaps()
    });
  }

  // Called after every FACEIT check of a live match (src/arena.js): post the card when the
  // draft has just finished, and edit it when something on it changed.
  async function onGameSync(record, match) {
    if (!enabled() || !config.arenaGamesChannelId) return;
    if (!rating) await recompute();
    const links = await listArenaLinks();
    const card = liveCard(record, match, links);
    const signature = JSON.stringify(card);
    const state = await getArenaHubState();
    if (!state.cards?.[record.id]) {
      const channel = await textChannel(config.arenaGamesChannelId);
      if (!channel) return;
      const message = await channel.send(cardPayload(card));
      await saveArenaHubState({ cards: { [record.id]: message.id } });
      cardSignatures.set(record.id, signature);
      scheduleBoard();
      return;
    }
    if (cardSignatures.get(record.id) === signature) return;
    const first = !cardSignatures.has(record.id);
    cardSignatures.set(record.id, signature);
    if (first) return; // the bot restarted: nothing new to show yet
    const message = await cardMessage(record.id);
    await message?.edit(cardPayload(card)).catch(() => null);
    scheduleBoard();
  }

  // Voice activity by FACEIT player: when they first joined a team channel, when they were
  // last seen in one, and for how long.
  function voiceByPlayer(record, links) {
    const byDiscord = new Map(Object.entries(links).map(([playerId, link]) => [link.discordId, playerId]));
    const voice = {};
    for (const [discordId, entry] of Object.entries(record.voice || {})) {
      const playerId = byDiscord.get(discordId);
      if (!playerId || !entry) continue;
      voice[playerId] = { joinedAt: entry.first || null, leftAt: entry.last || null, seconds: Math.round(entry.s || 0) };
    }
    return voice;
  }

  // The match is over: save it, work out the rating changes and finish the card. A cancelled
  // match is saved too and its card says so.
  async function onGameEnd(record, status) {
    if (!enabled()) return;
    cardSignatures.delete(record.id);
    scheduleBoard();
    leaderboardAt = 0;
    const voice = voiceByPlayer(record, await listArenaLinks());
    if (/FINISHED/i.test(String(status || '')) && await saveResult(record.id, { number: record.number, voice })) return;
    const match = await faceit.getMatchRaw(record.id).catch(() => null);
    const cancelled = match ? cancelledGame(match, { number: record.number, voice, seasons: await seasons() }) : null;
    if (cancelled) await games.upsert(cancelled);
    const message = await cardMessage(record.id);
    await message?.edit(cardPayload(matchCard({ stage: 'cancelled', number: record.number, teams: record.teams || [], url: record.faceitUrl || null }))).catch(() => null);
    await saveArenaHubState({ cards: { [record.id]: null }, pending: { [record.id]: null } });
  }

  // Reads the finished match from FACEIT. With its stats (or once the wait for them is over)
  // it is saved, the ratings are replayed and the card gets the winner, score, top fragger and
  // each player's rating change. Returns false when FACEIT has no result for it.
  async function saveResult(matchId, { number = null, voice = null } = {}) {
    const match = await faceit.getMatchRaw(matchId).catch(() => null);
    if (!match) return false;
    const stats = await faceit.getMatchStats(matchId).catch(() => null);
    const game = compactGame(match, stats, { number, voice, seasons: await seasons() });
    if (!game) return false;
    const state = await getArenaHubState();
    const since = Date.parse(state.pending?.[matchId]?.since || '') || now();
    const waiting = !game.hasStats && now() - since < STATS_WAIT_MS;
    const links = await listArenaLinks();
    if (waiting) {
      // Show the result now; the rating waits for the stats (ADR decides loss protection).
      const message = await cardMessage(matchId);
      await message?.edit(cardPayload(matchCard({ stage: 'finished', number: game.number, teams: game.teams, game, links, pending: true, placementGames: settings.placementGames, ...ratingMaps() }))).catch(() => null);
      await saveArenaHubState({ pending: { [matchId]: { since: new Date(since).toISOString(), number, voice } } });
      return true;
    }
    await games.upsert(game);
    await recompute({ announce: true });
    const message = await cardMessage(matchId);
    await message?.edit(cardPayload(matchCard({
      stage: 'finished', number: game.number, teams: game.teams, game, result: rating.games.get(matchId) || null, links, placementGames: settings.placementGames, ...ratingMaps()
    }))).catch(() => null);
    await saveArenaHubState({ cards: { [matchId]: null }, pending: { [matchId]: null } });
    leaderboardAt = 0;
    return true;
  }

  async function retryPendingStats() {
    const { pending = {} } = await getArenaHubState();
    for (const [matchId, entry] of Object.entries(pending)) await saveResult(matchId, { number: entry.number ?? null, voice: entry.voice || null });
  }

  // ---------- the live board and the queue status ----------

  function scheduleBoard() {
    if (!enabled() || boardTimer) return;
    boardTimer = setTimeout(() => {
      boardTimer = null;
      refreshBoard().catch((error) => console.warn(`[Arena] live board failed: ${error.message}`));
    }, BOARD_DEBOUNCE_MS);
    boardTimer.unref?.();
  }

  // Every match FACEIT lists as ongoing, each FACEIT check (src/arena.js): the ones still in
  // the captain draft go on the board as "drafting".
  function onPoll(ongoing = []) {
    const next = ongoing
      .filter((match) => match?.match_id && !arenaMatchOver(match.status) && !arenaTeamsLocked(match, config.arenaTeamSize || 5))
      .map((match) => ({ id: match.match_id, teams: arenaTeams(match).map((team) => ({ label: team.label })), url: arenaFaceitUrl(match) }));
    if (JSON.stringify(next) !== JSON.stringify(drafting)) {
      drafting = next;
      scheduleBoard();
    }
  }

  async function refreshBoard() {
    if (!enabled() || !config.arenaGamesChannelId) return;
    const state = await getArenaHubState();
    const channel = await textChannel(config.arenaGamesChannelId);
    const cardUrl = (matchId) => (state.cards?.[matchId] && channel?.guild?.id ? `https://discord.com/channels/${channel.guild.id}/${channel.id}/${state.cards[matchId]}` : null);
    const records = (await listArenaMatches()).filter((record) => !record.endingAt).sort((a, b) => (a.number || 0) - (b.number || 0));
    const live = records.map((record) => ({ number: record.number, stage: 'live', teams: record.teams || [], map: record.map || null, score: null, cardUrl: cardUrl(record.id), url: record.faceitUrl || null }));
    const known = new Set(records.map((record) => record.id));
    const body = { games: [...drafting.filter((match) => !known.has(match.id)).map((match) => ({ number: null, stage: 'drafting', teams: match.teams, url: match.url })), ...live] };
    const key = JSON.stringify(body);
    if (key !== lastBoardBody && await keptUpsert('board', config.arenaGamesChannelId, liveBoardText({ ...body, updatedAt: new Date(now()) }), BOARD_HEADING)) lastBoardBody = key;

    const queueChannel = config.arenaQueueChannelId ? await client.channels.fetch(config.arenaQueueChannelId).catch(() => null) : null;
    const queue = [...(queueChannel?.members?.values?.() || [])].filter((member) => !member.user?.bot).map((member) => member.id);
    const queueKey = JSON.stringify(queue);
    if (queueKey !== lastQueueBody && await keptUpsert('queue', config.arenaGamesChannelId, queueText({ queue, queueChannelId: config.arenaQueueChannelId || null, updatedAt: new Date(now()) }), QUEUE_HEADING)) lastQueueBody = queueKey;
  }

  // Someone joined or left the Queue voice channel.
  function onVoiceStateUpdate(oldState, newState) {
    const queueId = config.arenaQueueChannelId;
    if (!queueId || oldState?.channelId === newState?.channelId) return;
    if (oldState?.channelId === queueId || newState?.channelId === queueId) scheduleBoard();
  }

  // ---------- the season leaderboard ----------

  async function seasonRows(season) {
    const rows = [];
    for (let offset = 0; offset < 500; offset += 50) {
      const data = season
        ? await faceit.request(`/leaderboards/hubs/${hubId}/seasons/${season.season}?offset=${offset}&limit=50`)
        : await faceit.request(`/leaderboards/hubs/${hubId}/general?offset=${offset}&limit=50`);
      const items = data?.items || [];
      rows.push(...items);
      if (items.length < 50) break;
    }
    return rows;
  }

  async function refreshLeaderboard() {
    leaderboardAt = now();
    if (!config.arenaDataChannelId) return;
    if (!rating) await recompute();
    const list = await seasons();
    const runningSeason = currentSeason(list, now());
    const season = runningSeason || latestSeason(list, now());
    const items = await seasonRows(season);
    if (season) positionCache.set(season.season, { at: now(), items });
    if (!hubUrl) hubUrl = String((await faceit.request(`/hubs/${hubId}`).catch(() => null))?.faceit_url || '').replace('{lang}', 'en') || null;
    const body = {
      name: season ? season.name : 'All time',
      items,
      banned: rating.banned,
      running: season ? Boolean(runningSeason) : true,
      url: hubUrl ? `${hubUrl}/leaderboard` : null,
      limit: config.arenaLeaderboardSize || 25,
      ...ratingMaps()
    };
    const text = leaderboardText({ ...body, updatedAt: new Date(0) });
    if (text === lastLeaderboardBody) return;
    if (await keptUpsert('leaderboard', config.arenaDataChannelId, leaderboardText({ ...body, updatedAt: new Date(now()) }), LEADERBOARD_HEADING)) lastLeaderboardBody = text;
  }

  // A player's place on a season's FACEIT leaderboard, or null.
  async function seasonPosition(seasonNumber, playerId) {
    const list = await seasons();
    const season = list.find((entry) => entry.season === seasonNumber);
    if (!season) return null;
    let cached = positionCache.get(seasonNumber);
    if (!cached || now() - cached.at > POSITION_CACHE_MS) {
      cached = { at: now(), items: await seasonRows(season).catch(() => []) };
      positionCache.set(seasonNumber, cached);
    }
    return cached.items.find((row) => row.player?.user_id === playerId)?.position ?? null;
  }

  // ---------- daily decay and the weekly recap ----------

  function dueToday(time, lastKey) {
    const { dateKey, minutes } = easternParts(now(), timeZone);
    const [hour, minute] = String(time).split(':').map(Number);
    return minutes >= hour * 60 + minute && lastKey !== dateKey ? dateKey : null;
  }

  // Once a day: the replay takes each inactive player's decay up to now (a row per day in the
  // rating history), then ranks, Rank X and roles follow.
  async function runDailyDecay() {
    const state = await getArenaHubState();
    const today = dueToday(config.arenaDecayTime || '05:00', state.lastDecayDay);
    if (!today || !state.backfill?.done) return;
    await recompute({ announce: true });
    await saveArenaHubState({ lastDecayDay: today });
    leaderboardAt = 0;
  }

  // Monday at ARENA_RECAP_TIME: the Monday-to-Sunday before, current Arena season only.
  async function postWeeklyRecap() {
    if (!config.arenaDataChannelId) return;
    const { dateKey } = easternParts(now(), timeZone);
    if (weekdayIndex(dateKey) !== 0) return;
    const state = await getArenaHubState();
    const monday = mondayOf(dateKey);
    if (!dueToday(config.arenaRecapTime || '12:00', null) || state.lastRecapWeek === monday) return;
    const fromMs = zoneMidnightMs(addDaysToKey(monday, -7), timeZone);
    const toMs = zoneMidnightMs(monday, timeZone);
    const list = await seasons();
    // The season the week belongs to: the one running now, or (the season just ended) the one
    // that week was played in. A week between seasons has none.
    const season = currentSeason(list, now())?.season ?? seasonAt(toMs - 1, list) ?? seasonAt(fromMs, list);
    if (!rating) await recompute();
    const recap = weeklyRecap(await games.all(), { fromMs, toMs, season: season ?? null, ratings: rating.games });
    const rankUps = (await ratingStore.get()).rankUps.filter((entry) => {
      const at = Date.parse(entry.at);
      return at >= fromMs && at < toMs;
    });
    const text = recapText(recap, { fromMs, toMs, seasonName: list.find((entry) => entry.season === season)?.name || null, rankUps, timeZone });
    if (text) {
      const channel = await textChannel(config.arenaDataChannelId);
      if (!channel) return;
      await channel.send({ content: text, allowedMentions: { parse: [] } });
    }
    await saveArenaHubState({ lastRecapWeek: monday });
  }

  // ---------- older matches from the FACEIT hub ----------

  function rateLimited(error) {
    if (!/^FACEIT 429:/.test(String(error?.message || ''))) return false;
    backoffStep = Math.min(backoffStep + 1, 5);
    backoffUntil = now() + 60_000 * 2 ** (backoffStep - 1);
    return true;
  }

  // A page of the hub's past matches at a time, a few stats requests per pass, backing off
  // when FACEIT says to slow down. When the end is reached the ratings are replayed once.
  async function backfill() {
    const state = await getArenaHubState();
    if (state.backfill?.done || now() < backoffUntil) return;
    const offset = Number(state.backfill?.offset) || 0;
    let page;
    try {
      page = (await faceit.request(`/hubs/${hubId}/matches?type=past&offset=${offset}&limit=${BACKFILL_PAGE}`))?.items || [];
    } catch (error) {
      if (rateLimited(error)) return;
      // FACEIT refuses offsets past its limit: that is as far back as it goes.
      if (/^FACEIT 400:/.test(String(error?.message || ''))) return finishBackfill(offset);
      warnOnce('backfill', `could not read older matches: ${error.message}`);
      return;
    }
    const list = await seasons();
    const todo = [];
    for (const match of page) {
      if (await games.has(match.match_id)) continue;
      const status = String(match.status || '').toUpperCase();
      if (status === 'FINISHED' || status === 'CANCELLED') todo.push(match);
    }
    const batch = todo.slice(0, BACKFILL_PER_TICK);
    const records = [];
    for (const match of batch) {
      if (String(match.status).toUpperCase() === 'CANCELLED') {
        records.push(cancelledGame(match, { seasons: list }));
        continue;
      }
      let stats = null;
      try {
        stats = await faceit.getMatchStats(match.match_id);
      } catch (error) {
        if (rateLimited(error)) break;
      }
      records.push(compactGame(match, stats, { seasons: list }));
    }
    if (records.filter(Boolean).length) await games.upsert(records.filter(Boolean));
    if (now() < backoffUntil || todo.length > batch.length) return; // more of this page next time
    backoffStep = 0;
    const next = offset + BACKFILL_PAGE;
    if (page.length < BACKFILL_PAGE || next >= BACKFILL_MAX_OFFSET) return finishBackfill(next);
    await saveArenaHubState({ backfill: { offset: next, done: false } });
  }

  async function finishBackfill(offset) {
    await saveArenaHubState({ backfill: { offset, done: true } });
    await recompute();
    console.log(`[Arena] older matches loaded from FACEIT: ${await games.count()} on record.\n${ratingSummaryText(ratingSummary(rating.players, rating.ranks, { settings, banned: rating.banned })).replace(/\*\*/g, '')}`);
  }

  // ---------- commands ----------

  // "@mention", a Discord id or a FACEIT nickname / profile link -> { playerId, discordId, typed }.
  async function resolvePlayer(text, fallbackUserId) {
    const links = await listArenaLinks();
    const byDiscord = (discordId) => Object.entries(links).find(([, link]) => link.discordId === discordId)?.[0] || null;
    const value = String(text || '').trim();
    if (!value) return { playerId: byDiscord(fallbackUserId), discordId: fallbackUserId, typed: null, links };
    const mention = value.match(/^<@!?(\d{15,25})>$/) || value.match(/^(\d{15,25})$/);
    if (mention) return { playerId: byDiscord(mention[1]), discordId: mention[1], typed: null, links };
    const nickname = parseFaceitNickname(value);
    const playerId = playerIdByNickname(await games.all(), nickname)
      || Object.entries(links).find(([, link]) => String(link.nickname || '').toLowerCase() === String(nickname || '').toLowerCase())?.[0]
      || (await faceit.getPlayerByNickname(nickname).catch(() => null))?.player_id
      || null;
    return { playerId, discordId: playerId ? links[playerId]?.discordId || null : null, typed: nickname, links };
  }

  async function handleStats(interaction) {
    const share = interaction.options.getBoolean('share') || false;
    await interaction.deferReply({ ephemeral: !share });
    if (!rating) await recompute();
    const who = await resolvePlayer(interaction.options.getString('player'), interaction.user.id);
    if (!who.playerId) {
      await interaction.editReply({
        content: who.typed
          ? `I couldn't find a FACEIT player called **${who.typed}**.`
          : who.discordId === interaction.user.id
            ? 'Your FACEIT account isn\'t linked yet. Link it with `/arena link`, or give `player:` a FACEIT name.'
            : `<@${who.discordId}> hasn't linked a FACEIT account. Try \`player:\` with their FACEIT name.`,
        allowedMentions: { parse: [] }
      });
      return;
    }
    const all = await games.all();
    const list = await seasons();
    const asked = interaction.options.getInteger('season');
    const shown = asked ?? (currentSeason(list, now()) || latestSeason(list, now()))?.season ?? null;
    const allTime = playerRecord(all, who.playerId, { ratings: rating.games });
    const nickname = allTime.nickname || who.links[who.playerId]?.nickname || who.typed || 'Player';
    const state = await getArenaHubState();
    const loading = !state.backfill?.done;
    if (!allTime.played) {
      await interaction.editReply(`**${nickname}** has no Arena games on record.${loading ? ' Older games are still being loaded from FACEIT, so try again later.' : ''}`);
      return;
    }
    const season = shown !== null ? playerRecord(all, who.playerId, { season: shown, ratings: rating.games }) : null;
    // Asking for a season shows that season's last games.
    if (asked !== null && season) allTime.last = season.last;
    const player = rating.players.get(who.playerId) || null;
    await interaction.editReply(cardPayload(statsCard({
      nickname,
      discordId: who.discordId,
      faceitUrl: `https://www.faceit.com/en/players/${encodeURIComponent(nickname)}`,
      rating: player,
      rank: rankOf(who.playerId),
      allTime,
      season,
      seasonName: shown !== null ? (list.find((entry) => entry.season === shown)?.name || `Season ${shown}`) : null,
      position: shown !== null && season?.played ? await seasonPosition(shown, who.playerId).catch(() => null) : null,
      decay: player ? decayStatus(player, now(), settings) : null,
      loading
    })));
  }

  function historyPayload(playerId, nickname, page, gameUrls) {
    const rows = rating.history.filter((row) => row.playerId === playerId);
    const view = historyPageText({ nickname, rows, page, perPage: HISTORY_PER_PAGE, gameUrls });
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`arenarh:${playerId}:${view.page - 1}`).setLabel('Newer').setStyle(ButtonStyle.Secondary).setDisabled(view.page <= 0),
      new ButtonBuilder().setCustomId(`arenarh:${playerId}:${view.page + 1}`).setLabel('Older').setStyle(ButtonStyle.Secondary).setDisabled(view.page >= view.pages - 1)
    );
    return { content: view.content, components: view.pages > 1 ? [buttons] : [], allowedMentions: { parse: [] } };
  }

  async function gameUrlMap() {
    return Object.fromEntries((await games.all()).filter((game) => game.url).map((game) => [game.id, game.url]));
  }

  // /arena rating history | adjust | recalc | ban (staff).
  async function handleRating(interaction) {
    if (!isStaff(interaction.member)) {
      await interaction.reply({ content: 'Only Staff and Arena Admins can use the rating tools.', ephemeral: true });
      return;
    }
    const sub = interaction.options.getSubcommand();
    if (sub === 'recalc') {
      await interaction.reply({
        content: 'Recalculate every CF rating? This replays every stored match, staff adjustment and decay in order from the start rating, then updates ranks and roles. Nothing is posted for rank changes.',
        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('arenarc:yes').setLabel('Yes, recalculate').setStyle(ButtonStyle.Danger))],
        ephemeral: true
      });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    if (!rating) await recompute();
    const who = await resolvePlayer(interaction.options.getString('player', true), null);
    if (!who.playerId) {
      await interaction.editReply({ content: who.typed ? `I couldn't find a FACEIT player called **${who.typed}**.` : `<@${who.discordId}> hasn't linked a FACEIT account.`, allowedMentions: { parse: [] } });
      return;
    }
    const nickname = rating.players.get(who.playerId)?.nickname || who.links[who.playerId]?.nickname || who.typed || who.playerId;
    if (sub === 'history') {
      await interaction.editReply(historyPayload(who.playerId, nickname, 0, await gameUrlMap()));
      return;
    }
    if (sub === 'adjust') {
      const amount = interaction.options.getInteger('amount', true);
      const reason = interaction.options.getString('reason', true).trim();
      if (!amount || !reason) {
        await interaction.editReply('Give an amount (not 0) and a reason.');
        return;
      }
      const before = ratingOf(who.playerId);
      await ratingStore.update((data) => {
        data.adjustments.push({ id: `adj-${now()}-${data.adjustments.length + 1}`, at: new Date(now()).toISOString(), playerId: who.playerId, amount, reason: reason.slice(0, 300), staffId: interaction.user.id, staffTag: interaction.user.username });
      });
      await recompute({ announce: true });
      leaderboardAt = 0;
      await interaction.editReply({ content: `**${nickname}**: ${amount > 0 ? '+' : '−'}${Math.abs(amount)} (${reason}). Rating ${before} → ${ratingOf(who.playerId)} · ${rankOf(who.playerId).label}. Ranks and roles follow.`, allowedMentions: { parse: [] } });
      return;
    }
    if (sub === 'ban') {
      const banned = interaction.options.getBoolean('banned') ?? true;
      await ratingStore.update((data) => {
        if (banned) data.banned[who.playerId] = { by: interaction.user.id, at: new Date(now()).toISOString() };
        else delete data.banned[who.playerId];
      });
      await recompute({ announce: !banned });
      leaderboardAt = 0;
      await interaction.editReply(banned
        ? `**${nickname}** is marked banned: their rating stays on record, but they are hidden from the leaderboard and can't hold Rank X.`
        : `**${nickname}** is no longer marked banned.`);
    }
  }

  // Buttons: rating history pages and the recalc confirmation.
  async function handleComponent(interaction) {
    if (!isStaff(interaction.member)) {
      await interaction.reply({ content: 'Only Staff and Arena Admins can use the rating tools.', ephemeral: true });
      return;
    }
    const [kind, first, second] = String(interaction.customId).split(':');
    if (kind === 'arenarh') {
      if (!rating) await recompute();
      const nickname = rating.players.get(first)?.nickname || first;
      await interaction.update(historyPayload(first, nickname, Number(second) || 0, await gameUrlMap()));
      return;
    }
    if (kind === 'arenarc') {
      await interaction.update({ content: 'Recalculating…', components: [] });
      await recompute();
      leaderboardAt = 0;
      const summary = ratingSummaryText(ratingSummary(rating.players, rating.ranks, { settings, banned: rating.banned }));
      await interaction.editReply({ content: `**CF ratings recalculated** from ${(await games.all()).filter(isFinished).length} matches.\n${summary}`.slice(0, 2000), allowedMentions: { parse: [] } });
    }
  }

  // ---------- the clock ----------

  async function tick() {
    if (!enabled() || running) return;
    running = true;
    try {
      const step = async (name, work) => {
        try {
          await work();
        } catch (error) {
          console.warn(`[Arena] ${name} failed: ${error.message}`);
        }
      };
      if (!rating) await step('ratings', recompute);
      await step('stats retry', retryPendingStats);
      await step('daily decay', runDailyDecay);
      await step('live board', refreshBoard);
      if (now() - leaderboardAt >= LEADERBOARD_EVERY_MS) await step('leaderboard', refreshLeaderboard);
      await step('rank roles', syncRankRoles);
      await step('weekly recap', postWeeklyRecap);
      await step('older matches', backfill);
    } finally {
      running = false;
    }
  }

  function start() {
    if (!enabled()) {
      console.log('Arena match data, rating and stats: off');
      return;
    }
    console.log(`Arena match data: cards, live board and queue in <#${config.arenaGamesChannelId}>, leaderboard and recap in <#${config.arenaDataChannelId}>`);
    const run = () => tick().catch((error) => console.warn(`[Arena] hub tick failed: ${error.message}`));
    run();
    if (!timer) {
      timer = setInterval(run, TICK_MS);
      timer.unref?.();
    }
  }

  return {
    start,
    tick,
    handleStats,
    handleRating,
    handleComponent,
    onVoiceStateUpdate,
    hooks: { onSync: onGameSync, onEnd: onGameEnd, onPoll },
    // For tests and staff tools.
    recompute,
    refreshBoard,
    refreshLeaderboard,
    backfill,
    ratings: () => rating
  };
}
