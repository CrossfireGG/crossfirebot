// "Join To Create" voice: joining ➕ Join To Create makes a new voice channel owned by that person
// and moves them into it. A settings panel (buttons) is posted in the channel's chat: rename, user
// limit, lock/unlock, hide/show, invite, kick, transfer and claim. The channel is deleted as soon
// as it is empty.
//
// The first time the bot starts with this on and no JOIN_TO_CREATE_CHANNEL_ID, it makes a
// "🔊 Voice" category with the ➕ Join To Create channel in it (once; if staff delete them later
// they are not made again).

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
  TextInputStyle,
  UserSelectMenuBuilder
} from 'discord.js';

import { deleteVoiceRoom, getVoiceRooms, saveVoiceRoom, saveVoiceRoomSetup } from './store.js';

const SWEEP_MS = 2 * 60 * 1000;
const CREATE_COOLDOWN_MS = 10 * 1000;
const RENAME_WAIT_MS = 4000;

const P = PermissionFlagsBits;
const OWNER_ALLOW = P.ViewChannel | P.Connect | P.Speak | P.Stream | P.UseVAD;
const GUEST_ALLOW = P.ViewChannel | P.Connect;
const BLOCKED_DENY = P.ViewChannel | P.Connect;
const BOT_ALLOW = P.ViewChannel | P.Connect | P.MoveMembers | P.ManageChannels | P.SendMessages | P.EmbedLinks;

// ---------- pure helpers (tested) ----------

export function defaultRoomName(displayName) {
  const name = String(displayName || 'Someone').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Someone';
  return `${name}'s channel`;
}

export function cleanRoomName(text) {
  const name = String(text || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  return name ? name.slice(0, 100) : null;
}

// 0-99 (0 = no limit). null when it isn't a number in range.
export function parseUserLimit(text) {
  const value = String(text || '').trim();
  if (!/^\d{1,2}$/.test(value)) return null;
  return Number(value);
}

// The full permission list for a room: the category's own overwrites, then the room's settings
// on top. Bitfields are bigints.
//   base: [{ id, type, allow, deny }]   room: { ownerId, locked, hidden, allowed: [], blocked: [] }
export function roomOverwrites({ everyoneId, botId, base = [], room }) {
  const byId = new Map(base.map((entry) => [entry.id, { id: entry.id, type: entry.type, allow: BigInt(entry.allow || 0n), deny: BigInt(entry.deny || 0n) }]));
  const set = (id, type, allow, deny) => {
    const entry = byId.get(id) || { id, type, allow: 0n, deny: 0n };
    entry.allow = (entry.allow & ~deny) | allow;
    entry.deny = (entry.deny & ~allow) | deny;
    byId.set(id, entry);
  };
  const everyoneDeny = (room.locked ? P.Connect : 0n) | (room.hidden ? P.ViewChannel : 0n);
  if (everyoneDeny || byId.has(everyoneId)) set(everyoneId, OverwriteType.Role, 0n, everyoneDeny);
  for (const id of room.blocked || []) set(id, OverwriteType.Member, 0n, BLOCKED_DENY);
  for (const id of room.allowed || []) set(id, OverwriteType.Member, GUEST_ALLOW, 0n);
  if (room.ownerId) set(room.ownerId, OverwriteType.Member, OWNER_ALLOW, 0n);
  if (botId) set(botId, OverwriteType.Member, BOT_ALLOW, 0n);
  return [...byId.values()];
}

// ---------- the bot side ----------

export function createVoiceRooms({ client, config, isAdminStaff = () => false }) {
  const lastCreated = new Map();
  const creating = new Set();
  let setupChecked = false;

  const enabled = () => Boolean(config.joinToCreateEnabled);

  function log(message) {
    console.log(`[Voice] ${message}`);
  }

  async function guildOf() {
    return client.guilds.fetch(config.discordGuildId).catch(() => null);
  }

  // The ➕ Join To Create channel id (made once if it doesn't exist yet).
  async function joinChannelId() {
    if (config.joinToCreateChannelId) return config.joinToCreateChannelId;
    const { setup } = await getVoiceRooms();
    return setup?.channelId || null;
  }

  async function ensureSetup() {
    if (!enabled() || setupChecked) return;
    setupChecked = true;
    if (config.joinToCreateChannelId) return;
    const { setup } = await getVoiceRooms();
    if (setup?.channelId) return;
    const guild = await guildOf();
    if (!guild) return;
    const category = await guild.channels.create({ name: config.joinToCreateCategoryName, type: ChannelType.GuildCategory, reason: 'Join To Create voice' });
    const channel = await guild.channels.create({ name: config.joinToCreateChannelName, type: ChannelType.GuildVoice, parent: category.id, reason: 'Join To Create voice' });
    await saveVoiceRoomSetup({ guildId: guild.id, categoryId: category.id, channelId: channel.id, createdAt: new Date().toISOString() });
    log(`made the ${category.name} category and ${channel.name} (${channel.id})`);
  }

  async function start() {
    if (!enabled()) {
      console.log('Join To Create voice: off (JOIN_TO_CREATE_ENABLED=false)');
      return;
    }
    await ensureSetup().catch((error) => console.error('[Voice] setup failed:', error.message));
    const channelId = await joinChannelId();
    console.log(`Join To Create voice: ${channelId ? `<#${channelId}>` : 'no channel'}`);
    await sweep().catch((error) => console.error('[Voice] sweep failed:', error.message));
    const timer = setInterval(() => sweep().catch((error) => console.error('[Voice] sweep failed:', error.message)), SWEEP_MS);
    timer.unref?.();
  }

  // Delete rooms that are empty (or gone), e.g. after a restart missed the last person leaving.
  async function sweep() {
    const { rooms } = await getVoiceRooms();
    for (const room of Object.values(rooms || {})) {
      const channel = await client.channels.fetch(room.channelId).catch((error) => (error?.code === 10003 ? null : undefined));
      if (channel === undefined) continue;
      if (!channel) {
        await deleteVoiceRoom(room.channelId);
        continue;
      }
      if ((channel.members?.size || 0) === 0 && Date.now() - Date.parse(room.createdAt || 0) > 30 * 1000) await removeRoom(channel, room);
    }
  }

  async function removeRoom(channel, room) {
    await channel.delete('Join To Create: empty').catch((error) => {
      if (error?.code !== 10003) console.warn(`[Voice] couldn't delete ${channel.name}: ${error.message}`);
    });
    await deleteVoiceRoom(room.channelId);
  }

  async function applyPermissions(channel, room) {
    const parent = channel.parent;
    const base = parent
      ? [...parent.permissionOverwrites.cache.values()].map((entry) => ({ id: entry.id, type: entry.type, allow: entry.allow.bitfield, deny: entry.deny.bitfield }))
      : [];
    await channel.permissionOverwrites.set(roomOverwrites({ everyoneId: channel.guild.roles.everyone.id, botId: client.user.id, base, room }), 'Join To Create settings');
  }

  // Called for every voice change. movedElsewhere: another feature (Arena) already moved them.
  async function onVoiceStateUpdate(oldState, newState, { movedElsewhere = false } = {}) {
    if (!enabled()) return;
    const { rooms } = await getVoiceRooms();

    // Someone left a room: delete it when it's empty.
    if (oldState.channelId && oldState.channelId !== newState.channelId && rooms?.[oldState.channelId]) {
      const channel = oldState.channel || await client.channels.fetch(oldState.channelId).catch(() => null);
      if (channel && (channel.members?.size || 0) === 0) await removeRoom(channel, rooms[oldState.channelId]);
    }

    const joinId = await joinChannelId();
    if (movedElsewhere || !joinId || newState.channelId !== joinId || oldState.channelId === joinId) return;
    await createRoomFor(newState, rooms || {});
  }

  async function createRoomFor(state, rooms) {
    const member = state.member;
    if (!member || member.user?.bot || creating.has(member.id)) return;

    // Already owns a room: go back to it instead of making another.
    const owned = Object.values(rooms).find((room) => room.ownerId === member.id);
    if (owned) {
      const existing = await client.channels.fetch(owned.channelId).catch(() => null);
      if (existing) {
        await state.setChannel(existing, 'Join To Create: back to your channel').catch(() => null);
        return;
      }
      await deleteVoiceRoom(owned.channelId);
    }
    if (Date.now() - (lastCreated.get(member.id) || 0) < CREATE_COOLDOWN_MS) {
      await state.disconnect('Join To Create: slow down').catch(() => null);
      return;
    }

    creating.add(member.id);
    try {
      lastCreated.set(member.id, Date.now());
      const join = state.channel;
      const room = { ownerId: member.id, locked: false, hidden: false, allowed: [], blocked: [], createdAt: new Date().toISOString() };
      const base = join?.parent
        ? [...join.parent.permissionOverwrites.cache.values()].map((entry) => ({ id: entry.id, type: entry.type, allow: entry.allow.bitfield, deny: entry.deny.bitfield }))
        : [];
      const channel = await state.guild.channels.create({
        name: defaultRoomName(member.displayName),
        type: ChannelType.GuildVoice,
        parent: join?.parentId || null,
        bitrate: join?.bitrate || undefined,
        permissionOverwrites: roomOverwrites({ everyoneId: state.guild.roles.everyone.id, botId: client.user.id, base, room }),
        reason: `Join To Create: ${member.user?.username || member.id}`
      });
      await saveVoiceRoom(channel.id, { ...room, channelId: channel.id, guildId: state.guild.id });
      const moved = await state.setChannel(channel, 'Join To Create: your new channel').then(() => true).catch(() => false);
      if (!moved) {
        await removeRoom(channel, { channelId: channel.id });
        return;
      }
      await channel.send(panelMessage(member.id)).catch((error) => console.warn(`[Voice] couldn't post the settings panel: ${error.message}`));
    } catch (error) {
      console.warn(`[Voice] couldn't make a channel for ${member.id}: ${error.message}`);
    } finally {
      creating.delete(member.id);
    }
  }

  function panelMessage(ownerId) {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🔊 Your voice channel')
      .setDescription([
        `<@${ownerId}>, this channel is yours. Set it up with the buttons below.`,
        '',
        '**Lock** stops new people joining (people you **Invite** still can). **Hide** takes it off the channel list. **Kick** removes someone and keeps them out.',
        'If the owner leaves, anyone in the channel can **Claim** it. The channel deletes itself when everyone leaves.'
      ].join('\n'));
    const button = (id, label, emoji, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(`vc_${id}`).setLabel(label).setEmoji(emoji).setStyle(style);
    return {
      content: `<@${ownerId}>`,
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(
          button('rename', 'Rename', '✏️'),
          button('limit', 'Limit', '👥'),
          button('lock', 'Lock', '🔒'),
          button('unlock', 'Unlock', '🔓'),
          button('hide', 'Hide', '🙈')
        ),
        new ActionRowBuilder().addComponents(
          button('show', 'Show', '👁️'),
          button('invite', 'Invite', '➕', ButtonStyle.Success),
          button('kick', 'Kick', '👢', ButtonStyle.Danger),
          button('transfer', 'Transfer', '🔁'),
          button('claim', 'Claim', '👑', ButtonStyle.Primary)
        )
      ],
      allowedMentions: { users: [ownerId] }
    };
  }

  // ---------- buttons ----------

  async function handleComponent(interaction) {
    const action = String(interaction.customId || '').replace(/^vc_/, '');
    const channelId = interaction.channelId;
    const { rooms } = await getVoiceRooms();
    const room = rooms?.[channelId];
    const reply = (content) => (interaction.deferred || interaction.replied
      ? interaction.editReply({ content, components: [], allowedMentions: { parse: [] } })
      : interaction.reply({ content, ephemeral: true, allowedMentions: { parse: [] } }));
    if (!room) return reply('This isn\'t a Join To Create channel any more.');
    const channel = interaction.channel?.id === channelId ? interaction.channel : await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return reply('This channel is gone.');

    const isOwner = interaction.user.id === room.ownerId;
    const staff = Boolean(isAdminStaff(interaction.member));

    if (action === 'claim') {
      if (isOwner) return reply('It\'s already yours.');
      if (!channel.members?.has(interaction.user.id)) return reply('Join the channel first, then claim it.');
      if (channel.members.has(room.ownerId)) return reply(`<@${room.ownerId}> is still here, so it's still theirs. They can **Transfer** it to you.`);
      const next = await saveVoiceRoom(channelId, { ownerId: interaction.user.id });
      await applyPermissions(channel, next).catch(() => null);
      await channel.send({ content: `👑 <@${interaction.user.id}> now owns this channel.`, allowedMentions: { parse: [] } }).catch(() => null);
      return reply('👑 It\'s yours now.');
    }

    if (!isOwner && !staff) return reply(`Only the owner, <@${room.ownerId}>, can do that. If they've left, use **Claim**.`);

    const update = async (patch, text) => {
      const next = await saveVoiceRoom(channelId, patch);
      await applyPermissions(channel, next);
      return reply(text);
    };

    if (action === 'lock') return update({ locked: true }, '🔒 Locked. Only people already here or ones you **Invite** can join.');
    if (action === 'unlock') return update({ locked: false }, '🔓 Unlocked. Anyone can join.');
    if (action === 'hide') return update({ hidden: true }, '🙈 Hidden from the channel list (people you **Invite** can still see it).');
    if (action === 'show') return update({ hidden: false }, '👁️ Visible on the channel list again.');

    if (action === 'rename' || action === 'limit') {
      const input = action === 'rename'
        ? new TextInputBuilder().setCustomId('value').setLabel('Channel name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setValue(channel.name.slice(0, 100))
        : new TextInputBuilder().setCustomId('value').setLabel('Max people (0 = no limit)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2).setValue(String(channel.userLimit || 0));
      return interaction.showModal(new ModalBuilder()
        .setCustomId(`vc_${action}_submit`)
        .setTitle(action === 'rename' ? 'Rename your channel' : 'Set a user limit')
        .addComponents(new ActionRowBuilder().addComponents(input)));
    }

    if (action === 'rename_submit') {
      await interaction.deferReply({ ephemeral: true });
      const name = cleanRoomName(interaction.fields.getTextInputValue('value'));
      if (!name) return reply('The name can\'t be empty.');
      const done = channel.setName(name, 'Join To Create: rename').then(() => true).catch((error) => error);
      const result = await Promise.race([done, new Promise((resolve) => setTimeout(() => resolve('slow'), RENAME_WAIT_MS))]);
      if (result === true) return reply(`✏️ Renamed to **${name}**.`);
      if (result === 'slow') return reply(`✏️ Renaming to **${name}**. Discord only allows 2 renames every 10 minutes, so it may take a few minutes to show.`);
      return reply(`Couldn't rename it: ${result.message}`);
    }

    if (action === 'limit_submit') {
      const limit = parseUserLimit(interaction.fields.getTextInputValue('value'));
      if (limit === null) return reply('Type a number from 0 to 99 (0 = no limit).');
      await channel.setUserLimit(limit, 'Join To Create: user limit');
      return reply(limit ? `👥 Limit set to **${limit}**.` : '👥 No limit.');
    }

    if (action === 'invite' || action === 'kick' || action === 'transfer') {
      const picker = new UserSelectMenuBuilder()
        .setCustomId(`vc_${action}_pick`)
        .setMinValues(1)
        .setMaxValues(action === 'transfer' ? 1 : 10)
        .setPlaceholder(action === 'invite' ? 'Who can join (even when locked)?' : action === 'kick' ? 'Who should be kicked and kept out?' : 'Who gets the channel? (must be in it)');
      return interaction.reply({ components: [new ActionRowBuilder().addComponents(picker)], ephemeral: true });
    }

    if (action === 'invite_pick') {
      await interaction.deferUpdate();
      const ids = interaction.values.filter((id) => id !== room.ownerId && id !== client.user.id);
      const allowed = [...new Set([...(room.allowed || []), ...ids])];
      const blocked = (room.blocked || []).filter((id) => !ids.includes(id));
      await update({ allowed, blocked }, `➕ Invited ${ids.map((id) => `<@${id}>`).join(', ') || 'nobody new'}. They can join even when it's locked or hidden.`);
      return null;
    }

    if (action === 'kick_pick') {
      await interaction.deferUpdate();
      const ids = interaction.values.filter((id) => id !== room.ownerId && id !== client.user.id && id !== interaction.user.id);
      const blocked = [...new Set([...(room.blocked || []), ...ids])];
      const allowed = (room.allowed || []).filter((id) => !ids.includes(id));
      const next = await saveVoiceRoom(channelId, { allowed, blocked });
      await applyPermissions(channel, next);
      for (const id of ids) {
        const member = channel.members?.get(id);
        if (member) await member.voice.disconnect('Join To Create: kicked by the owner').catch(() => null);
      }
      return reply(ids.length ? `👢 Kicked ${ids.map((id) => `<@${id}>`).join(', ')}. They can't come back unless you **Invite** them.` : 'You can\'t kick yourself or the owner.');
    }

    if (action === 'transfer_pick') {
      await interaction.deferUpdate();
      const id = interaction.values[0];
      if (!channel.members?.has(id)) return reply('They need to be in the channel to take it over.');
      if (id === room.ownerId) return reply('They already own it.');
      const blocked = (room.blocked || []).filter((entry) => entry !== id);
      const next = await saveVoiceRoom(channelId, { ownerId: id, blocked });
      await applyPermissions(channel, next);
      await channel.send({ content: `👑 <@${id}> now owns this channel.`, allowedMentions: { parse: [] } }).catch(() => null);
      return reply(`👑 Gave the channel to <@${id}>.`);
    }

    return reply('That button is out of date.');
  }

  return { start, sweep, onVoiceStateUpdate, handleComponent, ensureSetup };
}
