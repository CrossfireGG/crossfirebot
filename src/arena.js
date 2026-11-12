// Crossfire Arena 10mans voice: when a game's draft is done on FACEIT, each team gets a private
// voice channel in the Arena category (everyone can see it; only its players and Arena staff can join) and its
// players are dragged in. Anyone on the game who connects to voice later, or walks into the
// Queue, is moved to their team. When the game ends everyone goes back to the Queue and the two
// channels are deleted.
//
// Who is who: a FACEIT account is linked to a Discord account once and remembered. League players
// are linked from Roster Tracking (SteamID64 -> Discord cell); others by their Discord name matching
// their FACEIT name (people in Arena voice only), a "click your FACEIT name" post in arena-info, the
// Link FACEIT button, or /arena link.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  OverwriteType,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';

import {
  arenaChannelName,
  arenaDragOnJoin,
  arenaFaceitUrl,
  arenaMatchOver,
  arenaResolveTeams,
  arenaTeams,
  arenaTeamsLocked,
  isArenaChannelName,
  matchArenaPlayersByName,
  parseFaceitNickname,
  parseRosterSteamDiscord
} from './arenaLogic.js';
import {
  deleteArenaMatch,
  incrementCounter,
  linkArenaPlayer,
  listArenaLinks,
  listArenaMatches,
  saveArenaMatch,
  unlinkArenaPlayer
} from './store.js';

const ROSTER_CACHE_MS = 30 * 60 * 1000;
const ROSTER_LOOKUP_RETRY_MS = 30 * 60 * 1000;
// A game that drops off FACEIT's "ongoing" list but can't be confirmed over is ended after this.
const MISSING_GIVE_UP_MS = 15 * 60 * 1000;
const WARN_EVERY_MS = 10 * 60 * 1000;

const PLAYER_ALLOW = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.Stream,
  PermissionFlagsBits.UseVAD
];

export function createArena({ client, faceit, config, isAdminStaff = () => false, memberForDiscordText = async () => null }) {
  let running = false;
  let active = new Map();
  let rosterCache = { at: 0, map: new Map() };
  const rosterLookupFailedAt = new Map();
  const lastWarnings = new Map();
  const locks = new Map();

  const enabled = () => Boolean(config.arenaEnabled && config.arenaHubId && config.arenaCategoryId);

  function warn(key, message) {
    const now = Date.now();
    if (now - (lastWarnings.get(key) || 0) < WARN_EVERY_MS) return;
    lastWarnings.set(key, now);
    console.warn(`[Arena] ${message}`);
  }

  // One change to a game at a time (the poll, a button click and a slash command can overlap).
  function withLock(matchId, work) {
    const previous = locks.get(matchId) || Promise.resolve();
    const current = previous.catch(() => null).then(work);
    locks.set(matchId, current);
    return current.finally(() => {
      if (locks.get(matchId) === current) locks.delete(matchId);
    });
  }

  function isStaff(member) {
    if (!member) return false;
    if (config.arenaStaffRoleIds.some((roleId) => member.roles?.cache?.has?.(roleId))) return true;
    return Boolean(isAdminStaff(member));
  }

  async function arenaGuild() {
    const category = await client.channels.fetch(config.arenaCategoryId).catch(() => null);
    return category?.guild || null;
  }

  function start() {
    if (!enabled()) {
      console.log('Arena voice: off (ARENA_ENABLED=false or no ARENA_HUB_ID / ARENA_CATEGORY_ID)');
      return;
    }
    console.log(`Arena voice: watching FACEIT hub ${config.arenaHubId} every ${config.arenaPollSeconds}s`);
    const run = () => tick().catch((error) => warn('tick', `check failed: ${error.message}`));
    run();
    const timer = setInterval(run, config.arenaPollSeconds * 1000);
    timer.unref?.();
  }

  // ---------- the FACEIT poll ----------

  async function tick() {
    if (running || !enabled()) return;
    running = true;
    try {
      const guild = await arenaGuild();
      if (!guild) {
        warn('guild', `can't open the Arena category ${config.arenaCategoryId}`);
        return;
      }
      const ongoing = await faceit.getHubMatches(config.arenaHubId, 'ongoing', 50);
      const records = await listArenaMatches();
      active = new Map(records.map((record) => [record.id, record]));
      const seen = new Set();
      for (const match of ongoing) {
        if (!match?.match_id) continue;
        seen.add(match.match_id);
        const record = active.get(match.match_id);
        if (record) await withLock(record.id, () => syncMatch(guild, match));
        else if (arenaTeamsLocked(match, config.arenaTeamSize)) await withLock(match.match_id, () => startMatch(guild, match));
      }
      for (const record of records) {
        if (!seen.has(record.id)) await withLock(record.id, () => checkGone(guild, record.id));
      }
    } finally {
      running = false;
    }
  }

  async function currentRecord(matchId) {
    const record = (await listArenaMatches()).find((entry) => entry.id === matchId) || null;
    if (record) active.set(matchId, record);
    else active.delete(matchId);
    return record;
  }

  async function startMatch(guild, match) {
    if (await currentRecord(match.match_id)) return syncMatch(guild, match);
    const number = await incrementCounter('arenaMatch');
    const record = await saveArenaMatch(match.match_id, {
      number,
      guildId: guild.id,
      faceitUrl: arenaFaceitUrl(match),
      channels: {},
      dragged: {},
      createdAt: new Date().toISOString()
    });
    active.set(record.id, record);
    console.log(`[Arena] game ${number} (${match.match_id}): draft done, making team channels`);
    await syncMatch(guild, match);
  }

  // A game we track isn't on the ongoing list any more: end it once FACEIT says it's over (or
  // it has been missing for a while).
  async function checkGone(guild, matchId) {
    const record = await currentRecord(matchId);
    if (!record) return;
    const match = await faceit.getMatchRaw(matchId).catch((error) => {
      if (/^FACEIT 404:/.test(String(error?.message || ''))) return { status: 'CANCELLED' };
      warn(`gone:${matchId}`, `couldn't check game ${record.number}: ${error.message}`);
      return null;
    });
    if (match && arenaMatchOver(match.status)) return endMatch(guild, record, match.status);
    if (match && arenaTeamsLocked(match, config.arenaTeamSize)) return syncMatch(guild, match);
    const missingSince = Date.parse(record.missingSince || '') || 0;
    if (!missingSince) {
      await saveArenaMatch(matchId, { missingSince: new Date().toISOString() });
      return;
    }
    if (Date.now() - missingSince > MISSING_GIVE_UP_MS) return endMatch(guild, record, 'GONE');
  }

  // Make sure both team channels exist with the right people, drag anyone newly known, and keep
  // the "click your FACEIT name" post up to date.
  async function syncMatch(guild, match) {
    const record = await currentRecord(match.match_id);
    if (!record) return;
    if (arenaMatchOver(match.status)) return endMatch(guild, record, match.status);

    const teams = arenaTeams(match);
    await autoLink(guild, teams);
    const links = await listArenaLinks();
    const { members: linked, unknown } = arenaResolveTeams(teams, links);

    const members = {};
    for (const team of teams) {
      members[team.faction] = [];
      for (const discordId of linked[team.faction]) {
        if (await guild.members.fetch(discordId).catch(() => null)) members[team.faction].push(discordId);
      }
    }

    const channels = { ...(record.channels || {}) };
    const overwriteKeys = { ...(record.overwriteKeys || {}) };
    for (const [index, team] of teams.entries()) {
      const key = [...members[team.faction]].sort().join(',');
      const overwrites = teamOverwrites(guild, members[team.faction]);
      let channel = channels[team.faction] ? await guild.channels.fetch(channels[team.faction]).catch(() => null) : null;
      if (!channel) {
        channel = await guild.channels.create({
          name: arenaChannelName(record.number, team, index),
          type: ChannelType.GuildVoice,
          parent: config.arenaCategoryId,
          permissionOverwrites: overwrites,
          reason: `Crossfire Arena game ${record.number}`
        }).catch((error) => {
          warn(`create:${record.id}`, `couldn't make the voice channel for game ${record.number} (${team.label}): ${error.message}. The bot needs Manage Channels, Manage Roles, Move Members and Connect in the Arena category.`);
          return null;
        });
        if (!channel) continue;
        channels[team.faction] = channel.id;
        overwriteKeys[team.faction] = key;
      } else if (overwriteKeys[team.faction] !== key) {
        const ok = await channel.permissionOverwrites.set(overwrites, `Crossfire Arena game ${record.number}: roster changed`)
          .then(() => true)
          .catch((error) => {
            warn(`perm:${record.id}`, `couldn't update who can join game ${record.number}: ${error.message}`);
            return false;
          });
        if (ok) overwriteKeys[team.faction] = key;
      }
    }

    // Drag each player once, the first time we know who they are and their channel exists.
    // (After that, only connecting to voice or joining the Queue moves them; see onVoiceStateUpdate.)
    const dragged = { ...(record.dragged || {}) };
    for (const team of teams) {
      const channelId = channels[team.faction];
      if (!channelId) continue;
      for (const discordId of members[team.faction]) {
        if (dragged[discordId] === channelId) continue;
        dragged[discordId] = channelId;
        await dragTo(guild, discordId, channelId);
      }
    }

    const next = {
      ...record,
      faceitUrl: arenaFaceitUrl(match) || record.faceitUrl,
      channels,
      overwriteKeys,
      dragged,
      members,
      teams: teams.map((team) => ({ faction: team.faction, label: team.label, players: team.players.map(({ playerId, nickname }) => ({ playerId, nickname })) })),
      missingSince: null
    };
    next.claimMessageId = await updateClaimPost(next, unknown);
    next.unknownKey = unknown.map((player) => player.playerId).sort().join(',');
    if (JSON.stringify(next) !== JSON.stringify(record)) {
      active.set(record.id, await saveArenaMatch(record.id, next));
    }
  }

  function teamOverwrites(guild, discordIds) {
    return [
      // Everyone can see the channel (so people know games are on) but only the team and staff can join.
      { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.Connect] },
      {
        id: client.user.id,
        type: OverwriteType.Member,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.ManageChannels]
      },
      ...config.arenaStaffRoleIds
        .filter((roleId) => guild.roles.cache.has(roleId))
        .map((roleId) => ({ id: roleId, type: OverwriteType.Role, allow: PLAYER_ALLOW })),
      ...[...new Set(discordIds)].map((discordId) => ({ id: discordId, type: OverwriteType.Member, allow: PLAYER_ALLOW }))
    ];
  }

  // Moves someone who is in voice (anywhere in the server) into a channel. Discord doesn't let a
  // bot pull in someone who isn't in voice, so they're left alone.
  async function dragTo(guild, discordId, channelId) {
    const state = guild.voiceStates.cache.get(discordId);
    if (!state?.channelId || state.channelId === channelId) return false;
    return state.setChannel(channelId, 'Crossfire Arena: your team\'s voice channel')
      .then(() => true)
      .catch((error) => {
        warn(`move:${discordId}`, `couldn't move ${discordId}: ${error.message}`);
        return false;
      });
  }

  async function endMatch(guild, record, status) {
    for (const channelId of Object.values(record.channels || {})) {
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel) continue;
      if (config.arenaQueueChannelId) {
        for (const member of channel.members?.values?.() || []) {
          await member.voice.setChannel(config.arenaQueueChannelId, 'Crossfire Arena: game over').catch(() => null);
        }
      }
      await channel.delete(`Crossfire Arena game ${record.number} over`).catch((error) => warn(`delete:${channelId}`, `couldn't delete ${channel.name}: ${error.message}`));
    }
    await deleteClaimPost(record);
    await deleteArenaMatch(record.id);
    active.delete(record.id);
    console.log(`[Arena] game ${record.number} (${record.id}) ${String(status || 'over').toLowerCase()}: channels removed`);
  }

  // ---------- linking ----------

  async function rosterSteamMap() {
    if (Date.now() - rosterCache.at < ROSTER_CACHE_MS) return rosterCache.map;
    try {
      const url = `https://docs.google.com/spreadsheets/d/${config.rosterSpreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(config.rosterSheetName)}&headers=0`;
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      rosterCache = { at: Date.now(), map: parseRosterSteamDiscord(await response.text()) };
    } catch (error) {
      warn('roster', `couldn't read Roster Tracking for Steam IDs: ${error.message}`);
      rosterCache = { at: Date.now() - ROSTER_CACHE_MS + 5 * 60 * 1000, map: rosterCache.map };
    }
    return rosterCache.map;
  }

  // Links the players nobody has linked yet: league players from Roster Tracking (by Steam ID),
  // then by name against the people sitting in Arena voice.
  async function autoLink(guild, teams) {
    let links = await listArenaLinks();
    const players = teams.flatMap((team) => team.players).filter((player) => !links[player.playerId]);
    if (!players.length) return;

    const now = Date.now();
    const leagueCandidates = players.filter((player) => player.steamId && now - (rosterLookupFailedAt.get(player.playerId) || 0) > ROSTER_LOOKUP_RETRY_MS);
    if (leagueCandidates.length) {
      const steamMap = await rosterSteamMap();
      for (const player of leagueCandidates) {
        const discordText = steamMap.get(player.steamId);
        const member = discordText ? await memberForDiscordText(guild, discordText).catch(() => null) : null;
        const result = member
          ? await linkArenaPlayer({ playerId: player.playerId, nickname: player.nickname, discordId: member.id, source: 'league roster' })
          : { ok: false };
        if (result.ok) console.log(`[Arena] linked ${player.nickname} from Roster Tracking`);
        else rosterLookupFailedAt.set(player.playerId, now);
      }
      links = await listArenaLinks();
    }

    const left = players.filter((player) => !links[player.playerId]);
    if (!left.length) return;
    const pool = [...guild.voiceStates.cache.values()]
      .filter((state) => state.channel?.parentId === config.arenaCategoryId && state.member && !state.member.user?.bot)
      .map((state) => ({
        id: state.id,
        names: [state.member.user?.username, state.member.user?.globalName, state.member.nickname, state.member.displayName]
      }));
    const taken = new Set(Object.values(links).map((link) => link.discordId));
    for (const [playerId, discordId] of matchArenaPlayersByName(left, pool, taken)) {
      const player = left.find((entry) => entry.playerId === playerId);
      const result = await linkArenaPlayer({ playerId, nickname: player.nickname, discordId, source: 'name match' });
      if (result.ok) console.log(`[Arena] linked ${player.nickname} by name`);
    }
  }

  // ---------- the "click your FACEIT name" post ----------

  async function infoChannel() {
    const channel = config.arenaInfoChannelId ? await client.channels.fetch(config.arenaInfoChannelId).catch(() => null) : null;
    return channel?.isTextBased?.() ? channel : null;
  }

  // Returns the post's message id (null when nobody is unknown).
  async function updateClaimPost(record, unknown) {
    const key = unknown.map((player) => player.playerId).sort().join(',');
    if (key === (record.unknownKey || '') && (record.claimMessageId || !unknown.length)) return record.claimMessageId || null;
    if (!unknown.length) {
      await deleteClaimPost(record);
      return null;
    }
    const channel = await infoChannel();
    if (!channel) {
      warn('info', `can't post in the arena-info channel ${config.arenaInfoChannelId}`);
      return record.claimMessageId || null;
    }
    const buttons = unknown.slice(0, 20).map((player) => new ButtonBuilder()
      .setCustomId(`arena_claim:${record.id}:${player.playerId}`)
      .setLabel(player.nickname.slice(0, 80) || 'Unknown player')
      .setStyle(ButtonStyle.Primary));
    const rows = [];
    for (let index = 0; index < buttons.length; index += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(index, index + 5)));
    if (record.faceitUrl && rows.length < 5) {
      rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Match room').setURL(record.faceitUrl)));
    }
    const payload = {
      content: [
        `🎮 **Arena ${record.number}**: the draft is done, but I don't know who ${unknown.length === 1 ? 'this player is' : 'these players are'} on Discord.`,
        '**Click your FACEIT name** and I\'ll move you to your team\'s voice channel. You only have to do this once.'
      ].join('\n'),
      components: rows,
      allowedMentions: { parse: [] }
    };
    const existing = record.claimMessageId ? await channel.messages.fetch(record.claimMessageId).catch(() => null) : null;
    if (existing) {
      await existing.edit(payload).catch((error) => warn(`claim:${record.id}`, `couldn't update the claim post: ${error.message}`));
      return existing.id;
    }
    const sent = await channel.send(payload).catch((error) => {
      warn(`claim:${record.id}`, `couldn't post in arena-info: ${error.message}`);
      return null;
    });
    return sent?.id || null;
  }

  async function deleteClaimPost(record) {
    if (!record.claimMessageId) return;
    const channel = await infoChannel();
    const message = channel ? await channel.messages.fetch(record.claimMessageId).catch(() => null) : null;
    await message?.delete().catch(() => null);
  }

  async function staffLog(content) {
    const channelId = config.arenaStaffLogChannelId || config.callAdminChannelId;
    const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
    if (channel?.isTextBased?.()) await channel.send({ content, allowedMentions: { parse: [] } }).catch(() => null);
  }

  // After a link changes: re-sync the game this person is in (if any), so they get access and are
  // dragged right away.
  async function refreshGamesFor(playerId) {
    const guild = await arenaGuild();
    if (!guild) return;
    for (const record of await listArenaMatches()) {
      const inGame = (record.teams || []).some((team) => team.players.some((player) => player.playerId === playerId));
      if (!inGame) continue;
      const match = await faceit.getMatchRaw(record.id).catch(() => null);
      if (match) await withLock(record.id, () => syncMatch(guild, match));
    }
  }

  function linkFailureText(result, nickname, selfLink) {
    if (result.reason === 'taken') {
      return selfLink
        ? `**${nickname}** is already linked to someone else on Discord. Staff have been told; if it really is you, open a ticket.`
        : `**${nickname}** is already linked to <@${result.existing.discordId}>.`;
    }
    return selfLink
      ? `You're already linked to **${result.existing.nickname}** on FACEIT. If that's wrong, run \`/arena unlink\` first.`
      : `That person is already linked to **${result.existing.nickname}** on FACEIT.`;
  }

  async function reportTakenClaim(user, nickname, existing, where) {
    await staffLog(`⚠️ **Arena:** <@${user.id}> tried to claim the FACEIT account **${nickname}** (${where}), but it's linked to <@${existing.discordId}>. If that's wrong, fix it with \`/arena link faceit:${nickname} user:@them\`.`);
  }

  // Link by FACEIT nickname (the Link FACEIT box, or /arena link).
  async function linkByNickname({ interaction, text, targetUser, byStaff }) {
    const nickname = parseFaceitNickname(text);
    if (!nickname) return 'That doesn\'t look like a FACEIT name. Type your FACEIT nickname exactly, or paste your FACEIT profile link.';
    const player = await faceit.getPlayerByNickname(nickname);
    if (!player?.player_id) return `I couldn't find **${nickname}** on FACEIT. Check the spelling (it's the name in your FACEIT profile link).`;
    const selfLink = targetUser.id === interaction.user.id && !byStaff;
    const result = await linkArenaPlayer({
      playerId: player.player_id,
      nickname: player.nickname || nickname,
      discordId: targetUser.id,
      source: byStaff ? 'staff' : 'self',
      linkedBy: interaction.user.id
    }, { replace: byStaff });
    if (!result.ok) {
      if (result.reason === 'taken' && selfLink) await reportTakenClaim(interaction.user, player.nickname || nickname, result.existing, 'Link FACEIT');
      return linkFailureText(result, player.nickname || nickname, selfLink);
    }
    await refreshGamesFor(player.player_id).catch((error) => warn('refresh', `refresh after link failed: ${error.message}`));
    const replaced = result.replaced?.length ? ` (replaced: ${result.replaced.map((link) => `**${link.nickname}** ↔ <@${link.discordId}>`).join(', ')})` : '';
    return selfLink
      ? `✅ You're linked to **${result.link.nickname}** on FACEIT. When your Arena draft is done, be in any voice channel and I'll move you to your team.`
      : `✅ Linked **${result.link.nickname}** to <@${targetUser.id}>${replaced}.`;
  }

  // ---------- buttons, the Link FACEIT box ----------

  async function handleComponent(interaction) {
    const id = interaction.customId || '';
    if (interaction.isButton() && id === 'arena_link') {
      const input = new TextInputBuilder()
        .setCustomId('faceit')
        .setLabel('Your FACEIT nickname (or profile link)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(120);
      await interaction.showModal(new ModalBuilder()
        .setCustomId('arena_link_submit')
        .setTitle('Link your FACEIT')
        .addComponents(new ActionRowBuilder().addComponents(input)));
      return;
    }
    if (interaction.isModalSubmit() && id === 'arena_link_submit') {
      await interaction.deferReply({ ephemeral: true });
      const text = interaction.fields.getTextInputValue('faceit');
      await interaction.editReply({ content: await linkByNickname({ interaction, text, targetUser: interaction.user, byStaff: false }), allowedMentions: { parse: [] } });
      return;
    }
    if (interaction.isButton() && id === 'arena_unlink') {
      await interaction.deferReply({ ephemeral: true });
      const removed = await unlinkArenaPlayer({ discordId: interaction.user.id });
      await interaction.editReply(removed.length ? `Unlinked from **${removed.map((link) => link.nickname).join(', ')}**.` : 'You weren\'t linked to a FACEIT account.');
      return;
    }
    if (interaction.isButton() && id.startsWith('arena_claim:')) {
      await handleClaim(interaction);
      return;
    }
    await interaction.reply({ content: 'That button is out of date.', ephemeral: true }).catch(() => null);
  }

  async function handleClaim(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const [, matchId, playerId] = interaction.customId.split(':');
    const record = await currentRecord(matchId);
    if (!record) {
      await interaction.editReply('That game is over.');
      return;
    }
    const player = (record.teams || []).flatMap((team) => team.players).find((entry) => entry.playerId === playerId);
    if (!player) {
      await interaction.editReply('That player isn\'t in this game any more.');
      return;
    }
    const result = await linkArenaPlayer({ playerId, nickname: player.nickname, discordId: interaction.user.id, source: 'claimed', linkedBy: interaction.user.id });
    if (!result.ok) {
      if (result.reason === 'taken') await reportTakenClaim(interaction.user, player.nickname, result.existing, `Arena ${record.number}`);
      await interaction.editReply({ content: linkFailureText(result, player.nickname, true), allowedMentions: { parse: [] } });
      return;
    }
    await refreshGamesFor(playerId);
    const guild = interaction.guild || await arenaGuild();
    const inVoice = Boolean(guild?.voiceStates.cache.get(interaction.user.id)?.channelId);
    await interaction.editReply(inVoice
      ? `✅ You're linked to **${player.nickname}**. Moving you to your team now.`
      : `✅ You're linked to **${player.nickname}**. Join any voice channel (the **Queue** is easiest) and I'll move you to your team.`);
  }

  // ---------- voice ----------

  // Returns true when it moved them (so Join To Create leaves them alone).
  async function onVoiceStateUpdate(oldState, newState) {
    if (!enabled() || !active.size) return false;
    if (!arenaDragOnJoin(oldState.channelId, newState.channelId, config.arenaQueueChannelId)) return false;
    for (const record of active.values()) {
      if (record.guildId !== newState.guild.id) continue;
      for (const [faction, ids] of Object.entries(record.members || {})) {
        if (!ids.includes(newState.id)) continue;
        const channelId = record.channels?.[faction];
        if (!channelId || newState.channelId === channelId) return false;
        return newState.setChannel(channelId, 'Crossfire Arena: your team\'s voice channel')
          .then(() => true)
          .catch((error) => {
            warn(`move:${newState.id}`, `couldn't move ${newState.id}: ${error.message}`);
            return false;
          });
      }
    }
    return false;
  }

  // ---------- /arena ----------

  async function handleCommand(interaction) {
    const sub = interaction.options.getSubcommand();
    const staff = isStaff(interaction.member);
    const staffOnly = async () => {
      await interaction.reply({ content: 'Only Arena staff can do that.', ephemeral: true });
    };

    if (sub === 'link') {
      const user = interaction.options.getUser('user');
      if (user && user.id !== interaction.user.id && !staff) return staffOnly();
      await interaction.deferReply({ ephemeral: true });
      const content = await linkByNickname({ interaction, text: interaction.options.getString('faceit', true), targetUser: user || interaction.user, byStaff: Boolean(user && staff) });
      await interaction.editReply({ content, allowedMentions: { parse: [] } });
      return;
    }

    if (sub === 'unlink') {
      const user = interaction.options.getUser('user');
      const faceitText = interaction.options.getString('faceit');
      if ((user && user.id !== interaction.user.id) || faceitText) {
        if (!staff) return staffOnly();
      }
      await interaction.deferReply({ ephemeral: true });
      let playerId = null;
      if (faceitText) {
        const links = await listArenaLinks();
        const nickname = parseFaceitNickname(faceitText) || faceitText;
        playerId = Object.values(links).find((link) => link.nickname.toLowerCase() === nickname.toLowerCase())?.playerId || null;
        if (!playerId) {
          await interaction.editReply(`Nobody is linked to **${nickname}**.`);
          return;
        }
      }
      const removed = await unlinkArenaPlayer({ discordId: playerId ? null : (user || interaction.user).id, playerId });
      await interaction.editReply({
        content: removed.length ? `Unlinked: ${removed.map((link) => `**${link.nickname}** ↔ <@${link.discordId}>`).join(', ')}.` : 'Nothing was linked.',
        allowedMentions: { parse: [] }
      });
      return;
    }

    if (sub === 'whois') {
      await interaction.deferReply({ ephemeral: true });
      const user = interaction.options.getUser('user') || interaction.user;
      const link = Object.values(await listArenaLinks()).find((entry) => entry.discordId === user.id);
      await interaction.editReply({
        content: link ? `<@${user.id}> is **${link.nickname}** on FACEIT (${link.source}).` : `<@${user.id}> isn't linked to a FACEIT account.`,
        allowedMentions: { parse: [] }
      });
      return;
    }

    if (!staff) return staffOnly();

    if (sub === 'panel') {
      await interaction.deferReply({ ephemeral: true });
      const channel = await infoChannel();
      if (!channel) {
        await interaction.editReply(`I can't post in <#${config.arenaInfoChannelId}>.`);
        return;
      }
      await channel.send(panelMessage());
      await interaction.editReply(`Posted the Link FACEIT panel in <#${channel.id}>.`);
      return;
    }

    if (sub === 'status') {
      await interaction.deferReply({ ephemeral: true });
      const records = await listArenaMatches();
      const links = Object.values(await listArenaLinks());
      const lines = [
        `Watching FACEIT hub \`${config.arenaHubId}\` every ${config.arenaPollSeconds}s${enabled() ? '' : ' (**off**)'}.`,
        `Linked players: **${links.length}**.`,
        records.length ? '**Games with voice channels:**' : 'No games running right now.',
        ...records.map((record) => {
          const unknown = record.unknownKey ? record.unknownKey.split(',').length : 0;
          const channels = Object.values(record.channels || {}).map((id) => `<#${id}>`).join(' · ');
          return `• Arena ${record.number}: ${channels || 'no channels yet'}${unknown ? ` · ${unknown} not linked` : ''}${record.faceitUrl ? ` · [match room](${record.faceitUrl})` : ''}`;
        })
      ];
      await interaction.editReply({ content: lines.join('\n'), allowedMentions: { parse: [] } });
      return;
    }

    if (sub === 'cleanup') {
      await interaction.deferReply({ ephemeral: true });
      const everything = interaction.options.getBoolean('everything') || false;
      const guild = await arenaGuild();
      if (!guild) {
        await interaction.editReply('I can\'t open the Arena category.');
        return;
      }
      let ended = 0;
      for (const record of await listArenaMatches()) {
        await withLock(record.id, async () => {
          const match = everything ? null : await faceit.getMatchRaw(record.id).catch(() => null);
          if (everything || !match || arenaMatchOver(match.status)) {
            await endMatch(guild, record, everything ? 'CLEANED UP' : (match?.status || 'GONE'));
            ended += 1;
          }
        });
      }
      const keep = new Set((await listArenaMatches()).flatMap((record) => Object.values(record.channels || {})));
      let removed = 0;
      const channels = await guild.channels.fetch().catch(() => null);
      for (const channel of channels?.values() || []) {
        if (!channel || channel.parentId !== config.arenaCategoryId || channel.type !== ChannelType.GuildVoice) continue;
        if (keep.has(channel.id) || !isArenaChannelName(channel.name)) continue;
        for (const member of channel.members?.values?.() || []) {
          if (config.arenaQueueChannelId) await member.voice.setChannel(config.arenaQueueChannelId, 'Crossfire Arena cleanup').catch(() => null);
        }
        if (await channel.delete('Crossfire Arena cleanup').then(() => true).catch(() => false)) removed += 1;
      }
      await interaction.editReply(`Ended ${ended} game${ended === 1 ? '' : 's'} and removed ${removed} leftover channel${removed === 1 ? '' : 's'}.`);
      return;
    }

    await interaction.reply({ content: 'Unknown /arena option.', ephemeral: true });
  }

  // The Link FACEIT / Unlink buttons, for the panel and for reposted messages.
  function linkButtonsRow() {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('arena_link').setLabel('Link FACEIT').setEmoji('🔗').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('arena_unlink').setLabel('Unlink').setStyle(ButtonStyle.Secondary)
    );
  }

  function panelMessage() {
    const embed = new EmbedBuilder()
      .setColor(0xff5500)
      .setTitle('🎮 Crossfire Arena voice')
      .setDescription([
        'When your 10man\'s draft is done on FACEIT, I make a **voice channel for each team** (only that team can join) and move you into yours. When the game ends, everyone goes back to the **Queue**.',
        '',
        '**Link your FACEIT once** so I know who you are: click **Link FACEIT** below. League players are usually linked already.',
        '',
        '**Be in voice** (the Queue is easiest) when the draft finishes. Discord doesn\'t let bots pull in people who aren\'t in a voice channel.'
      ].join('\n'));
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('arena_link').setLabel('Link FACEIT').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('arena_unlink').setLabel('Unlink').setStyle(ButtonStyle.Secondary)
    );
    return { embeds: [embed], components: [row] };
  }

  return { start, tick, handleCommand, handleComponent, onVoiceStateUpdate, isStaff, linkButtonsRow };
}
