// Local Arena simulator: see every message the Arena match-data features send, in the browser,
// with no Discord and no bot.
//   node tools/arena-sim.js        then open http://localhost:3212
// It runs the real code (src/arenaHub.js, src/arenaGames.js, src/arenaRating.js) against a
// pretend Discord, with a pretend live match you move along with buttons. The players, their
// history and the season leaderboard are the real ones from the FACEIT hub, read-only (the first
// start loads them, which takes about half a minute; they are kept in a temp folder).
// Nothing is posted to Discord and the bot's real data files are never touched.

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import 'dotenv/config';

const PORT = Number(process.env.ARENA_SIM_PORT || 3212);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = process.env.ARENA_SIM_DIR || path.join(os.tmpdir(), 'crossfire-arena-sim');
const FRESH = process.argv.includes('--fresh');
fs.mkdirSync(DIR, { recursive: true });
// The simulator's own files. Set before anything that reads these paths is loaded.
process.env.BOT_DATA_PATH = path.join(DIR, 'bot-data.json');
process.env.ARENA_GAMES_PATH = path.join(DIR, 'arena-games.json');
process.env.ARENA_RATINGS_PATH = path.join(DIR, 'arena-ratings.json');
for (const file of ['bot-data.json', 'arena-ratings.json', ...(FRESH ? ['arena-games.json'] : [])]) fs.rmSync(path.join(DIR, file), { force: true });
// Every start begins from the real history only: pretend matches from the last run are dropped.
try {
  const saved = JSON.parse(fs.readFileSync(process.env.ARENA_GAMES_PATH, 'utf8'));
  for (const id of Object.keys(saved.games || {})) if (id.startsWith('sim-')) delete saved.games[id];
  fs.writeFileSync(process.env.ARENA_GAMES_PATH, JSON.stringify(saved));
} catch {
  // No history saved yet: it is loaded from FACEIT below.
}

const { FaceitClient } = await import('../src/faceit.js');
const { createArenaHub, zoneMidnightMs } = await import('../src/arenaHub.js');
const { createGameStore, createRatingStore, isFinished } = await import('../src/arenaGames.js');
const { easternParts, addDaysToKey, weekdayIndex } = await import('../src/availability.js');
const store = await import('../src/store.js');

const HUB = process.env.ARENA_HUB_ID || 'ae1514c3-0041-4946-8d4f-10772d82e170';
const real = process.env.FACEIT_API_KEY ? new FaceitClient(process.env.FACEIT_API_KEY, []) : null;
if (!real) console.log('No FACEIT_API_KEY in .env: the simulator needs it to read the hub (read-only).');

// ---------- the pretend clock, Discord and FACEIT ----------

let clockOffset = 0;
const now = () => Date.now() + clockOffset;

const messages = []; // every message, in order
const roleLog = [];
const roles = [];
const names = { users: {}, channels: { games: '🎮┃arena-games', data: '🤖┃arena-data', queue: '⏳Queue', voiceA: '🔵 team voice', voiceB: '🔴 team voice' }, roles: {} };
const members = new Map();
const queueMembers = new Map();
let ephemeral = []; // what a command answered ("only you can see this")

function member(id) {
  if (!members.has(id)) {
    const held = new Set();
    const roleName = (roleId) => roles.find((role) => role.id === roleId)?.name || roleId;
    members.set(id, {
      id,
      user: { bot: false },
      roles: {
        cache: { has: (roleId) => held.has(roleId) },
        add: async (roleId) => { held.add(roleId); roleLog.push(`+ ${names.users[id] || id} gets the ${roleName(roleId)} role`); },
        remove: async (roleIds) => { for (const roleId of [].concat(roleIds)) if (held.delete(roleId)) roleLog.push(`− ${names.users[id] || id} loses the ${roleName(roleId)} role`); }
      }
    });
  }
  return members.get(id);
}

const guild = {
  id: 'guild',
  members: { fetch: async (id) => member(id) },
  roles: {
    cache: { has: (id) => roles.some((role) => role.id === id) },
    fetch: async () => new Map(roles.map((role) => [role.id, role])),
    create: async ({ name }) => {
      const role = { id: `role${roles.length + 1}`, name };
      roles.push(role);
      names.roles[role.id] = name;
      roleLog.push(`The bot makes the role "${name}"`);
      return role;
    }
  }
};

function makeChannel(id) {
  return {
    id,
    guild,
    isTextBased: () => true,
    send: async (payload) => {
      const message = { id: `${id}-${messages.length + 1}`, channelId: id, payload, edits: 0, pinned: false, at: now(), author: { id: 'bot' }, get content() { return message.payload.content || ''; } };
      message.edit = async (next) => { message.payload = { ...message.payload, ...next }; message.edits += 1; message.editedAt = now(); };
      message.pin = async () => { message.pinned = true; };
      messages.push(message);
      return message;
    },
    messages: {
      fetch: async (messageId) => messages.find((message) => message.id === messageId) || Promise.reject(Object.assign(new Error('Unknown Message'), { code: 10008 })),
      fetchPinned: async () => new Map(messages.filter((message) => message.channelId === id && message.pinned).map((message) => [message.id, message]))
    }
  };
}
const channels = { games: makeChannel('games'), data: makeChannel('data'), queue: { id: 'queue', members: queueMembers } };
const client = { user: { id: 'bot' }, channels: { fetch: async (id) => channels[id] || null } };

// The pretend live match. Everything else FACEIT is asked (seasons, leaderboard, older matches)
// goes to the real hub, read-only.
let sim = null; // { match, record, stats, statsReady }
let simCount = 0;
const faceit = {
  request: (requestPath) => real.request(requestPath),
  getMatchRaw: async (id) => (sim && sim.match.match_id === id ? sim.match : real.getMatchRaw(id)),
  getMatchStats: async (id) => {
    if (sim && sim.match.match_id === id) {
      if (!sim.statsReady) throw new Error('FACEIT 404: no stats yet');
      return sim.stats;
    }
    return real.getMatchStats(id);
  },
  getPlayerByNickname: (nickname) => real.getPlayerByNickname(nickname)
};

const config = {
  arenaEnabled: true,
  arenaHubId: HUB,
  arenaGamesChannelId: 'games',
  arenaDataChannelId: 'data',
  arenaQueueChannelId: 'queue',
  arenaQueueStatus: false,
  arenaTeamSize: 5,
  arenaTimeZone: 'America/Chicago',
  arenaRecapTime: '12:00',
  arenaDecayTime: '05:00',
  arenaLeaderboardSize: 25,
  arenaBannedFaceitIds: []
};
const games = createGameStore();
const ratingStore = createRatingStore();
let staff = true;
const hub = createArenaHub({ client, faceit, config, games, ratingStore, isStaff: () => staff, now });

// ---------- start: the real history ----------

if (real) {
  if (!(await games.count())) {
    console.log('Loading the hub\'s past matches from FACEIT (read-only), about half a minute...');
    for (let pass = 0; pass < 200 && !(await store.getArenaHubState()).backfill?.done; pass += 1) await hub.backfill();
  } else {
    await store.saveArenaHubState({ backfill: { offset: 0, done: true } });
  }
  await hub.recompute();
  console.log(`Arena simulator: ${(await games.all()).filter(isFinished).length} real matches, ${hub.ratings().players.size} players.`);
}

// The ten players of the pretend match: active players from the real history, plus one who is
// mid-placement and one who has never played. The first few are "linked" to pretend Discord
// accounts, so mentions and rank roles show.
function pickPlayers() {
  const all = [...hub.ratings().players.values()];
  const ranked = all.filter((player) => player.games >= 5).sort((a, b) => b.lastGameAt - a.lastGameAt).slice(0, 8);
  const placing = all.filter((player) => player.games > 0 && player.games < 4).sort((a, b) => b.lastGameAt - a.lastGameAt)[0];
  const picked = [...ranked.map((player) => ({ id: player.id, nickname: player.nickname }))];
  picked.push(placing ? { id: placing.id, nickname: placing.nickname } : { id: 'sim-placing', nickname: 'StillPlacing' });
  picked.push({ id: `sim-new-${simCount}`, nickname: 'BrandNewPlayer' });
  return picked;
}

async function linkSome(players) {
  for (const [index, player] of players.entries()) {
    if (index % 2 === 1 && index > 5) continue; // leave a few unlinked
    const discordId = `1000000000000000${String(10 + index)}`;
    names.users[discordId] = player.nickname;
    await store.linkArenaPlayer({ playerId: player.id, nickname: player.nickname, discordId, source: 'simulator' }, { replace: true }).catch(() => null);
  }
}

function matchObject(id, players, status, extra = {}) {
  const roster = (list) => list.map((player) => ({ player_id: player.id, nickname: player.nickname, game_player_id: '' }));
  const teamA = players.filter((_, index) => index % 2 === 0);
  const teamB = players.filter((_, index) => index % 2 === 1);
  return {
    match_id: id,
    competition_id: HUB,
    status,
    faceit_url: `https://www.faceit.com/{lang}/cs2/room/${id}`,
    started_at: Math.floor(now() / 1000),
    voting: {},
    teams: {
      faction1: { name: `team_${teamA[0].nickname}`, leader: teamA[0].id, roster: roster(teamA) },
      faction2: { name: `team_${teamB[0].nickname}`, leader: teamB[0].id, roster: roster(teamB) }
    },
    ...extra
  };
}

function simStats(match, winner, carry) {
  const seed = (text) => [...text].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 9973, 7);
  const line = (player, won, boost) => {
    const base = seed(player.player_id + match.match_id);
    const adr = Math.round((62 + (base % 34) + (won ? 6 : 0)) * boost * 10) / 10;
    const kills = Math.round(adr / 4.2);
    const deaths = won ? 13 + (base % 5) : 17 + (base % 5);
    const doubles = Math.min(Math.floor(kills / 5), 4);
    const triples = kills > 22 ? 1 : 0;
    return { player_id: player.player_id, nickname: player.nickname, player_stats: { Kills: String(kills), Deaths: String(deaths), Assists: String(2 + (base % 7)), ADR: String(adr), 'K/D Ratio': (kills / deaths).toFixed(2), 'Headshots %': String(30 + (base % 35)), MVPs: String(base % 6), 'Double Kills': String(doubles), 'Triple Kills': String(triples), 'Quadro Kills': '0', 'Penta Kills': '0' } };
  };
  const team = (faction, index) => ({
    players: match.teams[faction].roster.map((player, position) => line(player, winner === index, carry && winner !== index && position === 0 ? 1.75 : carry && winner !== index && position === 1 ? 1.25 : 1))
  });
  return { rounds: [{ round_stats: { Map: match.voting?.map?.pick?.[0] || 'de_mirage', Rounds: '22' }, teams: [team('faction1', 0), team('faction2', 1)] }] };
}

// ---------- what the page can do ----------

async function settle() {
  await hub.tick();
  await hub.refreshBoard();
}

const actions = {
  async newMatch() {
    if (sim && !sim.over) throw new Error('A match is already going. Finish or cancel it first.');
    simCount += 1;
    const players = pickPlayers();
    await linkSome(players);
    sim = { players, match: matchObject(`sim-match-${simCount}`, players.slice(0, 4), 'CAPTAIN_PICK'), record: null, stats: null, statsReady: false, over: false, stage: 'drafting' };
    hub.hooks.onPoll([sim.match]);
    await hub.refreshBoard();
  },
  async draftDone() {
    if (!sim || sim.stage !== 'drafting') throw new Error('Start a match first.');
    sim.match = matchObject(sim.match.match_id, sim.players, 'VOTING');
    const number = 40 + simCount;
    sim.record = await store.saveArenaMatch(sim.match.match_id, {
      number, guildId: 'guild', faceitUrl: `https://www.faceit.com/en/cs2/room/${sim.match.match_id}`, channels: { faction1: 'voiceA', faction2: 'voiceB' },
      teams: ['faction1', 'faction2'].map((faction) => ({ faction, label: sim.match.teams[faction].name.replace(/^team_/, 'Team '), players: sim.match.teams[faction].roster.map((player) => ({ playerId: player.player_id, nickname: player.nickname })) })),
      voice: {}
    });
    sim.stage = 'live';
    hub.hooks.onPoll([sim.match]);
    await hub.hooks.onSync(sim.record, sim.match);
    await hub.refreshBoard();
  },
  async mapPicked() {
    if (!sim || sim.stage !== 'live') throw new Error('The draft has to finish first.');
    sim.match = { ...sim.match, status: 'ONGOING', voting: { map: { pick: ['de_mirage'] }, location: { pick: ['Chicago'] } } };
    sim.record = await store.saveArenaMatch(sim.match.match_id, { map: 'Mirage' });
    await hub.hooks.onSync(sim.record, sim.match);
    await hub.refreshBoard();
  },
  async finish(body) {
    if (!sim || sim.stage !== 'live') throw new Error('There is no live match to finish.');
    const winner = body.winner === 1 ? 1 : 0;
    if (!sim.match.voting?.map) sim.match = { ...sim.match, voting: { map: { pick: ['de_mirage'] }, location: { pick: ['Chicago'] } } };
    sim.match = { ...sim.match, status: 'FINISHED', finished_at: Math.floor(now() / 1000), results: { winner: winner === 0 ? 'faction1' : 'faction2', score: { faction1: winner === 0 ? 13 : 9, faction2: winner === 0 ? 9 : 13 } } };
    sim.stats = simStats(sim.match, winner, Boolean(body.carry));
    sim.statsReady = !body.statsLater;
    // Linked players "were" in their team channel for the whole game.
    const links = await store.listArenaLinks();
    const voice = {};
    for (const player of sim.players) {
      const discordId = links[player.id]?.discordId;
      if (discordId) voice[discordId] = { first: new Date(now() - 45 * 60_000).toISOString(), last: new Date(now()).toISOString(), s: 2700 };
    }
    sim.record = await store.saveArenaMatch(sim.match.match_id, { voice, endingAt: new Date(now()).toISOString() });
    // What src/arena.js posts in each team voice channel's chat when the game ends.
    for (const id of ['voiceA', 'voiceB']) {
      messages.push({ id: `${id}-${messages.length + 1}`, channelId: id, payload: { content: `🏁 Game over. This channel closes <t:${Math.floor((now() + 30_000) / 1000)}:R> and everyone in it is moved back to <#queue>.` }, edits: 0, pinned: false, at: now() });
    }
    hub.hooks.onPoll([]);
    await hub.hooks.onEnd(sim.record, 'FINISHED');
    await store.deleteArenaMatch(sim.match.match_id);
    sim.stage = sim.statsReady ? 'done' : 'waiting';
    sim.over = sim.statsReady;
    await settle();
  },
  async statsArrive() {
    if (!sim || sim.stage !== 'waiting') throw new Error('No match is waiting for its stats.');
    sim.statsReady = true;
    await settle();
    sim.stage = 'done';
    sim.over = true;
  },
  async cancel() {
    if (!sim || !['drafting', 'live'].includes(sim.stage)) throw new Error('There is no match to cancel.');
    sim.match = { ...sim.match, status: 'CANCELLED' };
    hub.hooks.onPoll([]);
    if (sim.record) {
      await hub.hooks.onEnd(sim.record, 'CANCELLED');
      await store.deleteArenaMatch(sim.match.match_id);
    }
    sim.stage = 'done';
    sim.over = true;
    await settle();
  },
  async queue(body) {
    const id = `2000000000000000${String(10 + queueMembers.size)}`;
    if (body.leave) queueMembers.delete([...queueMembers.keys()].pop());
    else {
      names.users[id] = ['Zoro', 'Crown', 'steel', 'Nova', 'Matt', 'Kade', 'Remy', 'Jules'][queueMembers.size % 8];
      queueMembers.set(id, { id, user: { bot: false } });
    }
    await hub.refreshBoard();
  },
  // Jump the clock to the next daily decay run, or to the next Monday recap.
  async skipDays(body) {
    const days = Math.max(1, Math.min(60, Number(body.days) || 1));
    const today = easternParts(now(), config.arenaTimeZone).dateKey;
    clockOffset = zoneMidnightMs(addDaysToKey(today, days), config.arenaTimeZone) + 5 * 60 * 60_000 + 60_000 - Date.now();
    await settle();
  },
  async skipToMonday() {
    const today = easternParts(now(), config.arenaTimeZone).dateKey;
    const ahead = ((7 - weekdayIndex(today)) % 7) || 7;
    clockOffset = zoneMidnightMs(addDaysToKey(today, ahead), config.arenaTimeZone) + 12 * 60 * 60_000 + 60_000 - Date.now();
    await settle();
  },
  async tick() { await settle(); },
  async command(body) {
    staff = body.staff !== false;
    const replies = [];
    const options = body.options || {};
    const interaction = {
      user: { id: body.as || '100000000000000010', username: 'You' },
      member: {},
      customId: body.customId,
      options: {
        getBoolean: (name) => (typeof options[name] === 'boolean' ? options[name] : null),
        getString: (name) => (options[name] === undefined || options[name] === '' ? null : String(options[name])),
        getInteger: (name) => (options[name] === undefined || options[name] === '' ? null : Number(options[name])),
        getSubcommand: () => body.sub
      },
      reply: async (payload) => replies.push(payload),
      deferReply: async (payload) => { if (payload && payload.ephemeral === false) replies.push({ public: true }); },
      editReply: async (payload) => replies.push(payload),
      update: async (payload) => replies.push(payload)
    };
    if (body.customId) await hub.handleComponent(interaction);
    else if (body.command === 'stats') await hub.handleStats(interaction);
    else await hub.handleRating(interaction);
    const shared = replies.some((reply) => reply.public || reply.ephemeral === false);
    const last = replies.filter((reply) => !reply.public).at(-1);
    ephemeral = last ? [{ label: body.label || '/arena', shared, payload: typeof last === 'string' ? { content: last } : last, at: now() }] : [];
    await settle();
  }
};

// ---------- the page ----------

function plain(message) {
  const embed = message.payload.embeds?.[0]?.data || message.payload.embeds?.[0] || null;
  return {
    id: message.id,
    channelId: message.channelId,
    pinned: Boolean(message.pinned),
    edits: message.edits || 0,
    at: message.at,
    content: message.payload.content || '',
    embed: embed ? { title: embed.title, description: embed.description || '', fields: embed.fields || [], color: embed.color } : null,
    buttons: (message.payload.components || []).flatMap((row) => (row.components || []).map((button) => ({ label: button.data?.label, customId: button.data?.custom_id, disabled: Boolean(button.data?.disabled) })))
  };
}

async function view() {
  const links = await store.listArenaLinks();
  const rating = hub.ratings();
  const linked = Object.entries(links).map(([playerId, link]) => ({ playerId, discordId: link.discordId, nickname: link.nickname }));
  return {
    ready: Boolean(real && rating),
    clock: now(),
    stage: sim?.stage || 'none',
    matchNumber: sim?.record?.number || null,
    teams: sim ? ['faction1', 'faction2'].map((faction) => sim.match.teams[faction].name.replace(/^team_/, 'Team ')) : [],
    messages: messages.map(plain),
    ephemeral: ephemeral.map((entry) => ({ label: entry.label, shared: entry.shared, ...plain({ id: 'eph', channelId: 'eph', payload: entry.payload, at: entry.at }) })),
    roleLog,
    names,
    players: rating ? [...rating.players.values()].filter((player) => player.games >= 5).sort((a, b) => b.rating - a.rating).slice(0, 40).map((player) => player.nickname) : [],
    simPlayers: sim ? sim.players.map((player) => player.nickname) : [],
    linked,
    queue: queueMembers.size
  };
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (request.method === 'GET' && url.pathname === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(fs.readFileSync(path.join(HERE, 'arena-sim.html'), 'utf8'));
    return;
  }
  if (url.pathname !== '/api') {
    response.writeHead(404).end('Not found');
    return;
  }
  let raw = '';
  for await (const chunk of request) raw += chunk;
  let error = null;
  try {
    const body = raw ? JSON.parse(raw) : {};
    if (body.action) {
      if (!real) throw new Error('Add FACEIT_API_KEY to .env and start the simulator again.');
      const action = actions[body.action];
      if (!action) throw new Error('Unknown action.');
      await action(body);
    }
  } catch (caught) {
    error = caught.message;
  }
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ error, ...(await view()) }));
});

if (real) await settle().catch((error) => console.warn('First pass failed:', error.message));
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Arena simulator: http://localhost:${PORT}  (Ctrl+C to stop; --fresh reloads the history from FACEIT)`);
});
