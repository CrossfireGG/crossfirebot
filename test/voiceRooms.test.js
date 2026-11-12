import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { OverwriteType, PermissionFlagsBits as P } from 'discord.js';

// The store picks its file when first loaded, so point it at a temp file before loading anything
// that uses it (never the real bot-data.json).
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crossfire-voice-'));
process.env.BOT_DATA_PATH = path.join(tempDir, 'bot-data.json');
const store = await import('../src/store.js');
const { cleanRoomName, createVoiceRooms, defaultRoomName, parseUserLimit, roomOverwrites } = await import('../src/voiceRooms.js');

test('names and limits', () => {
  assert.equal(defaultRoomName('Zoro'), 'Zoro\'s channel');
  assert.equal(defaultRoomName(''), 'Someone\'s channel');
  assert.equal(cleanRoomName('  late\nnight   stack '), 'late night stack');
  assert.equal(cleanRoomName('   '), null);
  assert.equal(cleanRoomName('x'.repeat(150)).length, 100);
  assert.equal(parseUserLimit('5'), 5);
  assert.equal(parseUserLimit('0'), 0);
  assert.equal(parseUserLimit('100'), null);
  assert.equal(parseUserLimit('five'), null);
});

test('permissions: lock, hide, invite, kick on top of the category', () => {
  const base = [{ id: 'muted', type: OverwriteType.Role, allow: 0n, deny: P.Speak }];
  const open = roomOverwrites({ everyoneId: 'g', botId: 'bot', base, room: { ownerId: 'o' } });
  assert.equal(open.find((entry) => entry.id === 'g'), undefined, 'open room: no @everyone change');
  assert.ok(open.find((entry) => entry.id === 'muted').deny & P.Speak, 'category overwrites are kept');
  assert.ok(open.find((entry) => entry.id === 'o').allow & P.Connect);

  const shut = roomOverwrites({ everyoneId: 'g', botId: 'bot', room: { ownerId: 'o', locked: true, hidden: true, allowed: ['friend'], blocked: ['pest'] } });
  const of = (id) => shut.find((entry) => entry.id === id);
  assert.equal(of('g').deny & (P.Connect | P.ViewChannel), P.Connect | P.ViewChannel, 'locked + hidden for everyone');
  assert.equal(of('friend').allow & (P.Connect | P.ViewChannel), P.Connect | P.ViewChannel, 'invited people get in anyway');
  assert.equal(of('pest').deny & P.Connect, P.Connect, 'kicked people are kept out');
  assert.ok(of('bot').allow & P.MoveMembers);
});

function fakeGuild() {
  const channels = new Map();
  const voice = new Map(); // memberId -> channelId
  const sent = [];
  let next = 1;
  const guild = {
    id: 'g1',
    roles: { everyone: { id: 'g1' } },
    channels: {
      create: async (options) => {
        const id = `room${next++}`;
        const channel = {
          id,
          name: options.name,
          parentId: options.parent,
          parent: null,
          userLimit: 0,
          guild,
          overwrites: options.permissionOverwrites,
          permissionOverwrites: { set: async (list) => { channel.overwrites = list; } },
          get members() {
            return new Map([...voice].filter(([, channelId]) => channelId === id).map(([memberId]) => [memberId, {
              id: memberId,
              voice: { disconnect: async () => voice.delete(memberId) }
            }]));
          },
          send: async (payload) => { sent.push({ channelId: id, payload }); },
          delete: async () => channels.delete(id),
          setUserLimit: async (limit) => { channel.userLimit = limit; }
        };
        channels.set(id, channel);
        return channel;
      }
    }
  };
  const join = { id: 'jtc', parentId: 'cat', parent: { permissionOverwrites: { cache: new Map() } }, bitrate: 64000 };
  const state = (memberId, channelId) => ({
    id: memberId,
    channelId,
    guild,
    channel: channelId === 'jtc' ? join : channels.get(channelId) || null,
    member: { id: memberId, displayName: memberId === 'o' ? 'Owner' : memberId, user: { username: memberId, bot: false } },
    setChannel: async (target) => { voice.set(memberId, target.id || target); },
    disconnect: async () => voice.delete(memberId)
  });
  const client = {
    user: { id: 'bot' },
    channels: { fetch: async (id) => channels.get(id) || Promise.reject(Object.assign(new Error('Unknown Channel'), { code: 10003 })) },
    guilds: { fetch: async () => guild }
  };
  return { guild, channels, voice, sent, state, client };
}

function button(customId, userId, channelId, extra = {}) {
  const replies = [];
  return {
    replies,
    interaction: {
      customId,
      channelId,
      channel: null,
      user: { id: userId },
      member: { id: userId },
      deferred: false,
      replied: false,
      async reply(payload) { this.replied = true; replies.push(payload.content ?? payload); },
      async deferReply() { this.deferred = true; },
      async deferUpdate() { this.deferred = true; },
      async editReply(payload) { replies.push(payload.content ?? payload); },
      async showModal(modal) { replies.push({ modal: modal.data.custom_id }); },
      ...extra
    }
  };
}

test('join to create: make, move, settings, claim, delete when empty', async () => {
  const world = fakeGuild();
  const rooms = createVoiceRooms({ client: world.client, config: { joinToCreateEnabled: true, joinToCreateChannelId: 'jtc', discordGuildId: 'g1' } });

  // Owner joins Join To Create: a channel is made and they're moved in.
  world.voice.set('o', 'jtc');
  await rooms.onVoiceStateUpdate(world.state('o', null), world.state('o', 'jtc'));
  const [room] = world.channels.values();
  assert.equal(room.name, 'Owner\'s channel');
  assert.equal(room.parentId, 'cat');
  assert.equal(world.voice.get('o'), room.id);
  assert.equal(world.sent.length, 1, 'the settings panel is posted in the channel');
  assert.equal((await store.getVoiceRooms()).rooms[room.id].ownerId, 'o');

  // Joining again while owning one goes back to it.
  world.voice.set('o', 'jtc');
  await rooms.onVoiceStateUpdate(world.state('o', null), world.state('o', 'jtc'));
  assert.equal(world.channels.size, 1);
  assert.equal(world.voice.get('o'), room.id);

  // Arena already moved them: no channel.
  await rooms.onVoiceStateUpdate(world.state('arena', null), world.state('arena', 'jtc'), { movedElsewhere: true });
  assert.equal(world.channels.size, 1);

  // A guest can't change settings; the owner locks it.
  world.voice.set('guest', room.id);
  let click = button('vc_lock', 'guest', room.id);
  await rooms.handleComponent(click.interaction);
  assert.match(click.replies[0], /Only the owner/);
  click = button('vc_lock', 'o', room.id);
  await rooms.handleComponent(click.interaction);
  assert.match(click.replies[0], /Locked/);
  assert.ok(room.overwrites.find((entry) => entry.id === 'g1').deny & P.Connect);

  // Invite a friend, kick the guest.
  click = button('vc_invite_pick', 'o', room.id, { values: ['friend'] });
  await rooms.handleComponent(click.interaction);
  assert.ok(room.overwrites.find((entry) => entry.id === 'friend').allow & P.Connect);
  click = button('vc_kick_pick', 'o', room.id, { values: ['guest', 'o'] });
  await rooms.handleComponent(click.interaction);
  assert.match(click.replies[0], /Kicked <@guest>/);
  assert.equal(world.voice.has('guest'), false, 'kicked out of voice');
  assert.ok(room.overwrites.find((entry) => entry.id === 'guest').deny & P.Connect);

  // Limit and rename open a box.
  click = button('vc_limit', 'o', room.id);
  await rooms.handleComponent(click.interaction);
  assert.deepEqual(click.replies[0], { modal: 'vc_limit_submit' });
  click = button('vc_limit_submit', 'o', room.id, { fields: { getTextInputValue: () => '5' } });
  await rooms.handleComponent(click.interaction);
  assert.equal(room.userLimit, 5);

  // Owner leaves, friend stays and claims it.
  world.voice.set('friend', room.id);
  world.voice.delete('o');
  await rooms.onVoiceStateUpdate(world.state('o', room.id), world.state('o', null));
  assert.equal(world.channels.size, 1, 'not empty yet');
  click = button('vc_claim', 'friend', room.id);
  await rooms.handleComponent(click.interaction);
  assert.match(click.replies[0], /yours now/);
  assert.equal((await store.getVoiceRooms()).rooms[room.id].ownerId, 'friend');

  // Last person leaves: deleted.
  world.voice.delete('friend');
  await rooms.onVoiceStateUpdate(world.state('friend', room.id), world.state('friend', null));
  assert.equal(world.channels.size, 0);
  assert.deepEqual((await store.getVoiceRooms()).rooms, {});
});
