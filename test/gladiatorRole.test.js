import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// The stores pick their files when first loaded: point them at a temp folder first.
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crossfire-gladiator-'));
process.env.BOT_DATA_PATH = path.join(tempDir, 'bot-data.json');
process.env.ARENA_GAMES_PATH = path.join(tempDir, 'arena-games.json');
process.env.ARENA_RATINGS_PATH = path.join(tempDir, 'arena-ratings.json');
const store = await import('../src/store.js');
const { createGameStore, createRatingStore } = await import('../src/arenaGames.js');
const { createArenaHub } = await import('../src/arenaHub.js');

test.after(() => fs.rm(tempDir, { recursive: true, force: true }));

const DAY = 86400000;
const START = Date.UTC(2026, 0, 1);
const line = (id) => ({ id, n: `nick-${id}`, k: 10, d: 10, a: 2, adr: 75, hr: 1 });
const game = (index, a, b) => ({
  id: `g${index}`, status: 'finished', number: index + 1, season: null, map: 'Mirage', score: [13, 7], winner: 0, hasStats: true, rounds: 20, sv: 2,
  finishedAt: new Date(START + index * DAY).toISOString(),
  teams: [{ label: 'Team A', captain: a[0], players: a.map(line) }, { label: 'Team B', captain: b[0], players: b.map(line) }]
});

test('the Gladiator role: given, warned by DM when the timer starts and near its end, then removed', async () => {
  const roles = [];
  const log = [];
  const members = new Map();
  const member = (id) => {
    if (!members.has(id)) {
      const held = new Set();
      const name = (roleId) => roles.find((role) => role.id === roleId)?.name;
      members.set(id, {
        id,
        send: async (payload) => { log.push(`dm ${id}: ${payload.content}`); },
        roles: {
          cache: { has: (roleId) => held.has(roleId) },
          add: async (roleId) => { held.add(roleId); log.push(`+${id}:${name(roleId)}`); },
          remove: async (roleIds) => { for (const roleId of [].concat(roleIds)) if (held.delete(roleId)) log.push(`-${id}:${name(roleId)}`); }
        }
      });
    }
    return members.get(id);
  };
  const guild = {
    members: { fetch: async (id) => member(id) },
    roles: {
      cache: { has: (id) => roles.some((role) => role.id === id) },
      fetch: async () => new Map(roles.map((role) => [role.id, role])),
      create: async ({ name }) => { const role = { id: `r${roles.length + 1}`, name }; roles.push(role); return role; }
    }
  };
  const sent = [];
  const channel = (id) => ({
    id, guild, isTextBased: () => true,
    send: async (payload) => { const message = { id: `${id}-${sent.length}`, payload, edit: async () => {}, pin: async () => {} }; sent.push(message); return message; },
    messages: { fetch: async () => { throw Object.assign(new Error('Unknown Message'), { code: 10008 }); }, fetchPinned: async () => new Map() }
  });
  const channels = { games: channel('games'), data: channel('data') };
  const client = { user: { id: 'bot' }, channels: { fetch: async (id) => channels[id] || null } };
  const faceit = { request: async () => ({ items: [] }), getMatchRaw: async () => null, getMatchStats: async () => null, getPlayerByNickname: async () => null };
  const clock = { ms: START + 32 * DAY };
  const config = { arenaEnabled: true, arenaHubId: 'hub', arenaGamesChannelId: 'games', arenaDataChannelId: 'data', arenaTeamSize: 5, arenaTimeZone: 'America/Chicago', arenaBannedFaceitIds: [], arenaGladiators: true, arenaGladiatorDms: false };

  // p and o play the first 12 games; then 20 games finish without p (the last on day 31).
  const games = createGameStore(path.join(tempDir, 'games.json'));
  await games.upsert([
    ...Array.from({ length: 12 }, (_, index) => game(index, ['p', 'x'], ['o', 'u'])),
    ...Array.from({ length: 20 }, (_, index) => game(12 + index, ['x'], ['o', 'u']))
  ]);
  await store.linkArenaPlayer({ playerId: 'p', nickname: 'nick-p', discordId: 'd-p', source: 'self' });
  await store.linkArenaPlayer({ playerId: 'o', nickname: 'nick-o', discordId: 'd-o', source: 'self' });
  // The role was switched on before any of these games, so every missed game counts.
  await store.saveArenaHubState({ backfill: { offset: 0, done: true }, gladiatorSince: new Date(START - DAY).toISOString() });
  const hub = createArenaHub({ client, faceit, config, games, ratingStore: createRatingStore(path.join(tempDir, 'ratings.json')), isStaff: () => false, now: () => clock.ms });
  const gladiator = () => log.filter((entry) => /Gladiator|^dm /.test(entry));
  const ends = Math.floor((START + 31 * DAY + 14 * DAY) / 1000);

  // Both linked players hold it (x and u qualify too, but are not linked). The DMs are off
  // by default: nobody is sent anything.
  await hub.tick();
  assert.deepEqual(gladiator().filter((entry) => entry.startsWith('dm')), []);
  // With them on, p is told the timer has started.
  config.arenaGladiatorDms = true;
  await hub.tick();
  assert.equal(roles.filter((role) => role.name === 'Gladiator').length, 1, 'the role is made once');
  assert.deepEqual(gladiator().filter((entry) => entry.startsWith('+')).sort(), ['+d-o:Gladiator', '+d-p:Gladiator']);
  assert.deepEqual(gladiator().filter((entry) => entry.startsWith('dm')), [
    `dm d-p: You hold the **Gladiator** role in CROSSFIRE Arena, and 20 Arena games have finished since your last one. Play one Arena game by <t:${ends}:F> (<t:${ends}:R>) to keep the role and your vote on Arena changes.`
  ]);
  await hub.tick();
  assert.equal(gladiator().length, 3, 'nothing is repeated');

  // Three days before the end: one reminder.
  clock.ms = START + 43 * DAY;
  await hub.tick();
  await hub.tick();
  assert.deepEqual(gladiator().slice(3), [`dm d-p: Reminder: play one Arena game by <t:${ends}:F> (<t:${ends}:R>) to keep the **Gladiator** role. After that it is removed.`]);

  // The timer runs out: the role goes, o keeps theirs.
  clock.ms = START + 45 * DAY + 1000;
  await hub.tick();
  assert.deepEqual(gladiator().slice(4), ['-d-p:Gladiator']);
  assert.deepEqual((await store.getArenaHubState()).gladiatorByDiscord, { 'd-o': true });

  // Off: nothing is touched.
  const before = log.length;
  config.arenaGladiators = false;
  clock.ms += DAY;
  await hub.tick();
  assert.equal(log.filter((entry) => /Gladiator/.test(entry)).length, gladiator().length);
  assert.ok(log.length >= before);
});
