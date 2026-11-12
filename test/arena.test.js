import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  arenaChannelName,
  arenaDragOnJoin,
  arenaLinkConflict,
  arenaNameKey,
  arenaResolveTeams,
  arenaTeams,
  arenaTeamsLocked,
  isArenaChannelName,
  matchArenaPlayersByName,
  parseFaceitNickname,
  parseRosterSteamDiscord
} from '../src/arenaLogic.js';

function roster(prefix, count = 5) {
  return Array.from({ length: count }, (_, index) => ({
    player_id: `${prefix}${index + 1}`,
    nickname: `${prefix.toUpperCase()}-nick${index + 1}`,
    game_player_id: `765611980000000${prefix === 'a' ? 1 : 2}${index + 1}`
  }));
}

function faceitMatch({ id = 'm1', status = 'VOTING', a = roster('a'), b = roster('b') } = {}) {
  return {
    match_id: id,
    status,
    faceit_url: `https://www.faceit.com/{lang}/cs2/room/${id}`,
    teams: { faction1: { name: 'team_Zoro', roster: a }, faction2: { name: 'team_Beta', roster: b } }
  };
}

test('teams: FACEIT factions become labelled teams with Steam IDs', () => {
  const [first, second] = arenaTeams(faceitMatch());
  assert.equal(first.label, 'Team Zoro');
  assert.equal(second.label, 'Team Beta');
  assert.deepEqual(first.players[0], { playerId: 'a1', nickname: 'A-nick1', steamId: '76561198000000011' });
  assert.equal(arenaChannelName(12, first, 0), '🔵 Arena 12 · Team Zoro');
  assert.equal(arenaChannelName(12, second, 1), '🔴 Arena 12 · Team Beta');
  assert.ok(isArenaChannelName('🔴 Arena 12 · Team Beta'));
  assert.ok(!isArenaChannelName('Queue'));
});

test('teams are locked only after the draft, with both sides full, and not once it is over', () => {
  assert.equal(arenaTeamsLocked(faceitMatch({ status: 'CAPTAIN_PICK' })), false);
  assert.equal(arenaTeamsLocked(faceitMatch({ status: 'CHECK_IN' })), false);
  assert.equal(arenaTeamsLocked(faceitMatch({ status: 'VOTING', b: roster('b', 3) })), false, 'half-drafted');
  assert.equal(arenaTeamsLocked(faceitMatch({ status: 'VOTING' })), true);
  assert.equal(arenaTeamsLocked(faceitMatch({ status: 'READY' })), true);
  assert.equal(arenaTeamsLocked(faceitMatch({ status: 'ONGOING' })), true);
  assert.equal(arenaTeamsLocked(faceitMatch({ status: 'FINISHED' })), false);
  assert.equal(arenaTeamsLocked(faceitMatch({ status: 'VOTING', a: roster('a', 2), b: roster('b', 2) }), 2), true, 'team size is configurable');
});

test('name matching: only one clear member per player, ignoring case and symbols', () => {
  assert.equal(arenaNameKey('Zoro-'), 'zoro');
  const players = [{ playerId: 'p1', nickname: 'Zoro-' }, { playerId: 'p2', nickname: 'twin' }, { playerId: 'p3', nickname: 'Taken' }, { playerId: 'p4', nickname: 'nobody' }];
  const members = [
    { id: 'd1', names: ['zoro', 'Zoro The Great'] },
    { id: 'd2', names: ['twin'] },
    { id: 'd3', names: ['Twin'] },
    { id: 'd4', names: ['taken'] }
  ];
  const result = matchArenaPlayersByName(players, members, new Set(['d4']));
  assert.deepEqual([...result], [['p1', 'd1']], 'two members called twin: no guess; taken is already linked elsewhere');
  const both = matchArenaPlayersByName([{ playerId: 'x', nickname: 'same' }, { playerId: 'y', nickname: 'SAME' }], [{ id: 'd9', names: ['same'] }]);
  assert.equal(both.size, 0, 'one member never gets two FACEIT accounts');
});

test('Roster Tracking CSV: SteamID64 -> Discord cell', () => {
  const csv = [
    '"Team Info","Captain","","","","","",""',
    '"Starter 1","alpha","alpha#0001","…","…","…","US","76561198000000011","Full Name"',
    '"Starter 2","bravo","","…","…","…","US","76561198000000012",""',
    '"Starter 3","char,lie","charlie","…","…","…","US","7656 1198 0000 0001 3",""'
  ].join('\n');
  const map = parseRosterSteamDiscord(csv);
  assert.equal(map.get('76561198000000011'), 'alpha#0001');
  assert.equal(map.has('76561198000000012'), false, 'no Discord cell, nothing to link');
  assert.equal(map.get('76561198000000013'), 'charlie', 'spaces in the Steam ID and commas in quotes are fine');
});

test('dragging on join: connecting or walking into the Queue only', () => {
  assert.equal(arenaDragOnJoin(null, 'general', 'queue'), true, 'just connected');
  assert.equal(arenaDragOnJoin('general', 'queue', 'queue'), true, 'walked into the Queue');
  assert.equal(arenaDragOnJoin('team', 'general', 'queue'), false, 'moved somewhere on purpose');
  assert.equal(arenaDragOnJoin('general', null, 'queue'), false, 'left voice');
});

test('links: one FACEIT per Discord and one Discord per FACEIT', () => {
  const links = { p1: { playerId: 'p1', nickname: 'one', discordId: 'd1' } };
  assert.deepEqual(arenaLinkConflict(links, { playerId: 'p1', discordId: 'd1' }), { ok: true });
  assert.equal(arenaLinkConflict(links, { playerId: 'p1', discordId: 'd2' }).reason, 'taken');
  assert.equal(arenaLinkConflict(links, { playerId: 'p2', discordId: 'd1' }).reason, 'other');
  assert.deepEqual(arenaLinkConflict(links, { playerId: 'p2', discordId: 'd2' }), { ok: true });
  const { members, unknown } = arenaResolveTeams(arenaTeams(faceitMatch()), { a1: { discordId: 'd1' } });
  assert.deepEqual(members, { faction1: ['d1'], faction2: [] });
  assert.equal(unknown.length, 9);
});

test('FACEIT names: nickname, @nickname or a profile link', () => {
  assert.equal(parseFaceitNickname('Zoro-'), 'Zoro-');
  assert.equal(parseFaceitNickname('@Zoro-'), 'Zoro-');
  assert.equal(parseFaceitNickname('https://www.faceit.com/en/players/Zoro-/stats/cs2'), 'Zoro-');
  assert.equal(parseFaceitNickname('faceit.com/players/abc'), 'abc');
  assert.equal(parseFaceitNickname('two words'), null);
  assert.equal(parseFaceitNickname(''), null);
});

// ---------- the bot side, with a pretend Discord and FACEIT ----------

function fakeWorld() {
  const moves = [];
  const posts = [];
  const voice = new Map(); // discordId -> channelId
  const channels = new Map();
  const categoryId = 'cat';
  const queueId = 'queue';
  let nextChannel = 1;
  const memberIds = new Set(['d1', 'd2', 'd3', 'claimer', 'zoro']);

  const guild = {
    id: 'g1',
    roles: { everyone: { id: 'g1' }, cache: new Map([['staff', {}]]) },
    members: {
      fetch: async (id) => (memberIds.has(id) ? { id } : Promise.reject(new Error('Unknown Member')))
    },
    voiceStates: {
      cache: {
        get: (id) => (voice.has(id) ? stateFor(id) : undefined),
        values: () => [...voice.keys()].map(stateFor)
      }
    },
    channels: {
      fetch: async (id) => {
        if (id === undefined) return channels;
        return channels.get(id) || Promise.reject(new Error('Unknown Channel'));
      },
      create: async ({ name, parent, permissionOverwrites }) => {
        const channel = makeChannel(`vc${nextChannel++}`, name, parent, permissionOverwrites);
        return channel;
      }
    }
  };

  function stateFor(id) {
    const channelId = voice.get(id);
    return {
      id,
      channelId,
      guild,
      channel: channels.get(channelId) || { parentId: channelId === queueId ? categoryId : 'other' },
      member: { id, user: { username: id, bot: false }, displayName: id, nickname: null },
      setChannel: async (target) => {
        moves.push([id, target]);
        voice.set(id, target);
      }
    };
  }

  function makeChannel(id, name, parentId, overwrites) {
    const channel = {
      id,
      name,
      parentId,
      type: 2,
      overwrites,
      guild,
      deleted: false,
      permissionOverwrites: { set: async (next) => { channel.overwrites = next; } },
      get members() {
        return new Map([...voice].filter(([, channelId]) => channelId === id).map(([memberId]) => [memberId, {
          id: memberId,
          voice: { setChannel: async (target) => { moves.push([memberId, target]); voice.set(memberId, target); } }
        }]));
      },
      delete: async () => { channel.deleted = true; channels.delete(id); }
    };
    channels.set(id, channel);
    return channel;
  }

  const info = {
    id: 'info',
    isTextBased: () => true,
    send: async (payload) => {
      const message = { id: `msg${posts.length + 1}`, payload, deleted: false, edit: async (next) => { message.payload = next; }, delete: async () => { message.deleted = true; } };
      posts.push(message);
      return message;
    },
    messages: { fetch: async (id) => posts.find((message) => message.id === id && !message.deleted) || Promise.reject(new Error('Unknown Message')) }
  };
  const category = { id: categoryId, guild };
  const client = {
    user: { id: 'bot' },
    channels: { fetch: async (id) => (id === categoryId ? category : id === 'info' ? info : Promise.reject(new Error('nope'))) }
  };
  return { client, guild, voice, channels, moves, posts, queueId };
}

test('arena bot: draft done -> private team channels and drags; claim; late join; game over', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crossfire-arena-'));
  process.env.BOT_DATA_PATH = path.join(tempDir, 'bot-data.json');
  const store = await import(`../src/store.js?arena=${Date.now()}`);
  await store.linkArenaPlayer({ playerId: 'a1', nickname: 'A-nick1', discordId: 'd1', source: 'self' });
  await store.linkArenaPlayer({ playerId: 'b1', nickname: 'B-nick1', discordId: 'd2', source: 'self' });

  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, text: async () => '"Starter 1","x","d3","","","","","76561198000000025"' });
  test.after?.(() => { globalThis.fetch = realFetch; });

  const world = fakeWorld();
  world.voice.set('d1', 'queue');
  world.voice.set('zoro', 'queue'); // in the Queue, Discord name matches a FACEIT nickname
  let match = faceitMatch({ status: 'CAPTAIN_PICK', a: [...roster('a', 4), { player_id: 'a5', nickname: 'Zoro', game_player_id: '' }] });
  const faceit = {
    getHubMatches: async () => (match.status === 'FINISHED' ? [] : [match]),
    getMatchRaw: async () => match,
    getPlayerByNickname: async () => null
  };
  const config = {
    arenaEnabled: true,
    arenaHubId: 'hub',
    arenaCategoryId: 'cat',
    arenaQueueChannelId: 'queue',
    arenaInfoChannelId: 'info',
    arenaStaffRoleIds: ['staff'],
    arenaPollSeconds: 20,
    arenaTeamSize: 5,
    rosterSpreadsheetId: 'sheet',
    rosterSheetName: 'Roster Tracking'
  };
  const { createArena } = await import(`../src/arena.js?arena=${Date.now()}`);
  const arena = createArena({ client: world.client, faceit, config });

  await arena.tick();
  assert.equal(world.channels.size, 0, 'nothing happens during the captain draft');

  match = { ...match, status: 'VOTING' };
  await arena.tick();
  const made = [...world.channels.values()];
  assert.deepEqual(made.map((channel) => channel.name), ['🔵 Arena 1 · Team Zoro', '🔴 Arena 1 · Team Beta']);
  const [teamA, teamB] = made;
  const allowed = (channel) => channel.overwrites.filter((entry) => entry.allow?.length && entry.id !== 'bot').map((entry) => entry.id).sort();
  assert.deepEqual(allowed(teamA), ['d1', 'staff', 'zoro'], 'team A: its linked players (zoro by name) and staff');
  assert.deepEqual(allowed(teamB), ['d2', 'staff']);
  assert.ok(teamA.overwrites.some((entry) => entry.id === 'g1' && entry.deny.length), 'everyone else is denied');
  assert.deepEqual(world.moves, [['d1', teamA.id], ['zoro', teamA.id]], 'people in voice are dragged; d2 is not in voice');
  assert.equal((await store.listArenaLinks()).a5.source, 'name match');

  const post = world.posts[0];
  assert.match(post.payload.content, /Arena 1/);
  const claimIds = post.payload.components.flatMap((row) => row.components.map((button) => button.data.custom_id)).filter(Boolean);
  assert.equal(claimIds.length, 7, 'one button per unknown player (3 + 4)');

  await arena.tick();
  assert.equal(world.moves.length, 2, 'nobody is dragged twice');

  // d2 connects to voice: moved to their team
  await arena.onVoiceStateUpdate({ channelId: null }, { id: 'd2', channelId: 'general', guild: world.guild, setChannel: async (target) => { world.moves.push(['d2', target]); world.voice.set('d2', target); } });
  assert.deepEqual(world.moves.at(-1), ['d2', teamB.id]);
  // d1 moves somewhere on purpose: left alone
  const before = world.moves.length;
  await arena.onVoiceStateUpdate({ channelId: teamA.id }, { id: 'd1', channelId: 'general', guild: world.guild, setChannel: async () => world.moves.push(['d1', 'x']) });
  assert.equal(world.moves.length, before);

  // someone clicks "B-nick2"
  world.voice.set('claimer', 'queue');
  const replies = [];
  const claim = {
    customId: `arena_claim:m1:b2`,
    user: { id: 'claimer' },
    guild: world.guild,
    isButton: () => true,
    isModalSubmit: () => false,
    deferReply: async () => {},
    editReply: async (content) => replies.push(typeof content === 'string' ? content : content.content)
  };
  await arena.handleComponent(claim);
  assert.match(replies[0], /linked to \*\*B-nick2\*\*/);
  assert.ok(allowed(teamB).includes('claimer'), 'the claimer can now see team B');
  assert.deepEqual(world.moves.at(-1), ['claimer', teamB.id]);
  const remaining = world.posts[0].payload.components.flatMap((row) => row.components.map((button) => button.data.custom_id)).filter(Boolean);
  assert.equal(remaining.length, 6, 'the claimed name drops off the post');

  // someone else clicks the same name: refused
  await arena.handleComponent({ ...claim, user: { id: 'd3' } });
  assert.match(replies[1], /already linked to someone else/);

  // game over: everyone back to the Queue, channels and the post gone
  match = { ...match, status: 'FINISHED' };
  await arena.tick();
  assert.equal(world.channels.size, 0);
  assert.ok(teamA.deleted && teamB.deleted);
  for (const id of ['d1', 'd2', 'zoro', 'claimer']) assert.equal(world.voice.get(id), 'queue', `${id} is back in the Queue`);
  assert.equal(world.posts[0].deleted, true);
  assert.deepEqual(await store.listArenaMatches(), []);
});
