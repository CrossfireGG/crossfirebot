import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Point the store at a temp file before anything loads it.
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crossfire-reactroles-'));
process.env.BOT_DATA_PATH = path.join(tempDir, 'bot-data.json');
const { createReactionRoles, emojiKey, parseMessageLink } = await import('../src/reactionRoles.js');

const ROLES = [
  { emoji: '🎮', roleId: 'arena', label: 'Crossfire Arena' },
  { emoji: '🔔', roleId: 'ping', label: 'Game Ping' }
];

function fakeServer() {
  const memberRoles = new Map(); // userId -> Set
  const member = (id) => {
    if (!memberRoles.has(id)) memberRoles.set(id, new Set());
    const set = memberRoles.get(id);
    return {
      id,
      roles: {
        cache: { has: (roleId) => set.has(roleId) },
        add: async (roleId) => { set.add(roleId); },
        remove: async (roleId) => { set.delete(roleId); }
      }
    };
  };
  const guild = { id: 'g1', members: { fetch: async (id) => member(id) } };
  const reactors = { '🎮': ['early', 'bot'], '🔔': [] };
  const reacted = [];
  const message = {
    id: 'm1',
    guildId: 'g1',
    channelId: 'c1',
    guild,
    url: 'https://discord.com/channels/g1/c1/m1',
    react: async (emoji) => reacted.push(emoji),
    reactions: {
      cache: {
        find: (fn) => Object.keys(reactors).map((name) => ({
          emoji: { name },
          users: { fetch: async () => {
            const users = reactors[name].map((id) => [id, { id, bot: id === 'bot' }]);
            const map = new Map(users);
            map.last = () => users.at(-1)?.[1];
            return map;
          } }
        })).find(fn)
      }
    }
  };
  const channel = { messages: { fetch: async () => message }, send: async () => message };
  const client = { channels: { fetch: async () => channel }, guilds: { fetch: async () => guild } };
  return { client, channel, message, memberRoles, reacted };
}

test('helpers: emoji variants and message links', () => {
  assert.equal(emojiKey('🎮️'), emojiKey('🎮'));
  assert.deepEqual(parseMessageLink('https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333'), {
    guildId: '111111111111111111', channelId: '222222222222222222', messageId: '333333333333333333'
  });
  assert.equal(parseMessageLink('not a link'), null);
});

test('react for a role, unreact to drop it; other messages and emojis are ignored', async () => {
  const server = fakeServer();
  const roles = createReactionRoles({ client: server.client, roles: ROLES });
  const message = await roles.setUp({ channel: server.channel });
  assert.deepEqual(server.reacted, ['🎮', '🔔'], 'the bot adds both reactions');

  const reaction = (name, msg = message) => ({ message: msg, emoji: { name } });
  assert.equal(await roles.onReaction(reaction('🔔'), { id: 'u1' }, true), true);
  assert.ok(server.memberRoles.get('u1').has('ping'));
  await roles.onReaction(reaction('🎮'), { id: 'u1' }, true);
  assert.deepEqual([...server.memberRoles.get('u1')].sort(), ['arena', 'ping'], 'both roles');
  await roles.onReaction(reaction('🔔'), { id: 'u1' }, false);
  assert.deepEqual([...server.memberRoles.get('u1')], ['arena'], 'unreacting drops only that role');

  assert.equal(await roles.onReaction(reaction('🎮', { id: 'other' }), { id: 'u2' }, true), false, 'another message is not ours');
  assert.equal(server.memberRoles.has('u2'), false);
  await roles.onReaction(reaction('😀'), { id: 'u3' }, true);
  assert.equal(server.memberRoles.get('u3'), undefined, 'an emoji that is not on the list gives nothing');
  assert.equal(await roles.onReaction(reaction('🎮'), { id: 'b', bot: true }, true), false, 'bots are ignored');
});

test('start-up catch-up gives the role to people who reacted while the bot was down', async () => {
  const server = fakeServer();
  const roles = createReactionRoles({ client: server.client, roles: ROLES });
  await roles.setUp({ channel: server.channel });
  await roles.sync();
  assert.ok(server.memberRoles.get('early').has('arena'));
  assert.equal(server.memberRoles.has('bot'), false);
});
