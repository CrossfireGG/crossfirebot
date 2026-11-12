// Reaction roles: react to a message to get a role, remove the reaction to drop it. Staff set up a
// message with /arena roles (a new post, or an existing message by link). Reactions made while the
// bot was offline are picked up when it starts (adds only: nobody loses a role they already have).

import { EmbedBuilder } from 'discord.js';

import { getReactionRoleMessages, saveReactionRoleMessage } from './store.js';

// "🎮" and "🎮️" are the same emoji.
export function emojiKey(emoji) {
  return String(emoji || '').replace(/️/g, '');
}

// A Discord message link -> { guildId, channelId, messageId } or null.
export function parseMessageLink(text) {
  const match = String(text || '').match(/discord(?:app)?\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})/);
  return match ? { guildId: match[1], channelId: match[2], messageId: match[3] } : null;
}

export function createReactionRoles({ client, roles }) {
  let watched = null; // Set of message ids, loaded on first use

  async function watchedIds() {
    if (!watched) watched = new Set(Object.keys(await getReactionRoleMessages()));
    return watched;
  }

  function rolesMessage() {
    const embed = new EmbedBuilder()
      .setColor(0xff5500)
      .setTitle('🎮 Crossfire Arena roles')
      .setDescription([
        'React below to get a role. Remove your reaction to drop it.',
        '',
        ...roles.map((entry) => `${entry.emoji} **${entry.label}**${entry.description ? `: ${entry.description}` : ''}`)
      ].join('\n'));
    return { embeds: [embed] };
  }

  // Posts the roles message in channel (or sets up an existing message) and adds the reactions.
  async function setUp({ channel, existing = null }) {
    const message = existing || await channel.send(rolesMessage());
    for (const entry of roles) await message.react(entry.emoji).catch(() => null);
    await saveReactionRoleMessage(message.id, {
      guildId: message.guildId,
      channelId: message.channelId,
      roles: roles.map(({ emoji, roleId }) => ({ emoji, roleId })),
      createdAt: new Date().toISOString()
    });
    (await watchedIds()).add(message.id);
    return message;
  }

  // Returns true when the reaction was on a roles message (handled here).
  async function onReaction(reaction, user, added) {
    if (user?.bot) return false;
    const messageId = reaction.message?.id;
    if (!messageId || !(await watchedIds()).has(messageId)) return false;
    const record = (await getReactionRoleMessages())[messageId];
    if (!record) return false;
    const entry = record.roles.find((role) => emojiKey(role.emoji) === emojiKey(reaction.emoji?.name));
    if (!entry) return true;
    const guild = reaction.message.guild || await client.guilds.fetch(record.guildId).catch(() => null);
    const member = guild ? await guild.members.fetch(user.id).catch(() => null) : null;
    if (!member) return true;
    if (added && !member.roles.cache.has(entry.roleId)) {
      await member.roles.add(entry.roleId, 'Reaction role').catch((error) => console.warn(`[Reaction roles] couldn't give ${entry.roleId} to ${user.id}: ${error.message}`));
    }
    if (!added && member.roles.cache.has(entry.roleId)) {
      await member.roles.remove(entry.roleId, 'Reaction role removed').catch((error) => console.warn(`[Reaction roles] couldn't remove ${entry.roleId} from ${user.id}: ${error.message}`));
    }
    return true;
  }

  // On start: everyone who reacted gets the role (catches reactions made while the bot was down).
  async function sync() {
    const records = await getReactionRoleMessages();
    for (const [messageId, record] of Object.entries(records)) {
      const channel = await client.channels.fetch(record.channelId).catch(() => null);
      const message = channel?.messages ? await channel.messages.fetch(messageId).catch(() => null) : null;
      if (!message) continue;
      for (const entry of record.roles) {
        const reaction = message.reactions.cache.find((candidate) => emojiKey(candidate.emoji.name) === emojiKey(entry.emoji));
        if (!reaction) continue;
        let after;
        for (let page = 0; page < 50; page += 1) {
          const users = await reaction.users.fetch({ limit: 100, ...(after ? { after } : {}) }).catch(() => null);
          if (!users?.size) break;
          for (const user of users.values()) {
            if (user.bot) continue;
            const member = await message.guild.members.fetch(user.id).catch(() => null);
            if (member && !member.roles.cache.has(entry.roleId)) await member.roles.add(entry.roleId, 'Reaction role (catch-up)').catch(() => null);
          }
          after = users.last().id;
          if (users.size < 100) break;
        }
      }
    }
  }

  return { setUp, onReaction, sync, rolesMessage };
}
