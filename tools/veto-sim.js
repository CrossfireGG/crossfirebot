// Local veto simulator: run a playoff map veto in the browser, with no Discord and no bot.
//   node tools/veto-sim.js        then open http://localhost:3210
// It runs the bot's real veto code (src/veto.js, src/vetoEngine.js, src/store.js) against a
// pretend Discord: a match room, the veto staff channel, a captain and a player on each team, a
// staff member and someone on neither team. Click the veto buttons as any of them, run /cf veto,
// and move the clock forward to see the reminders before the match and the veto starting on its
// own. Every message, edit, delete and ping is exactly what the bot would do, so a change to the
// veto shows up here as soon as the simulator is restarted.
// Nothing is posted to Discord and the bot's real data file is never touched.

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.VETO_SIM_PORT || 3210);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = process.env.VETO_SIM_DIR || path.join(os.tmpdir(), 'crossfire-veto-sim');
fs.mkdirSync(DIR, { recursive: true });
// The simulator's own data file. Set before src/store.js is loaded.
const DATA_PATH = path.join(DIR, 'bot-data.json');
process.env.BOT_DATA_PATH = DATA_PATH;

// The simulator's clock. "Skip ahead" moves Date.now forward for everything the veto code reads,
// so the reminders, the automatic start and the turn clock all agree.
let clockOffset = 0;
const realNow = Date.now.bind(Date);
Date.now = () => realNow() + clockOffset;

const store = await import('../src/store.js');
const { createVetoBot } = await import('../src/veto.js');
const { vetoInProgress } = await import('../src/vetoEngine.js');

const DEFAULTS = {
  teamA: 'Alpha',
  teamB: 'Bravo',
  seedA: 1,
  seedB: 4,
  format: 'bo3',
  advantageTeam: 'teamA',
  mapPool: 'Dust2, Mirage, Nuke, Ancient, Inferno, Anubis, Cache',
  turnSeconds: 120,
  captainOnly: false,
  startsIn: 65
};

// ---------- the pretend Discord ----------

const messages = []; // every message in every channel, in order (deleted ones are flagged)
let messageCount = 0;
let reply = null; // the last "only you can see this" reply: { who, label, payload, at }
let setup = { ...DEFAULTS };
let matchId = null;
let matchCount = 0;
let bot = null;

const unknownMessage = () => Object.assign(new Error('Unknown Message'), { code: 10008 });
const normalize = (payload) => (typeof payload === 'string' ? { content: payload } : { ...(payload || {}) });

// Who a new message actually pings: mentions in the text that allowedMentions lets through.
function pingsOf(payload) {
  const content = String(payload.content || '');
  const allowed = payload.allowedMentions;
  const roles = [...content.matchAll(/<@&(\w+)>/g)].map((match) => match[1])
    .filter((id) => !allowed || allowed.parse?.includes('roles') || allowed.roles?.includes(id));
  const users = [...content.matchAll(/<@!?(\w+)>/g)].map((match) => match[1])
    .filter((id) => !allowed || allowed.parse?.includes('users') || allowed.users?.includes(id));
  return [...new Set([...roles.map((id) => `role:${id}`), ...users.map((id) => `user:${id}`)])];
}

const guild = { id: 'guild', roles: { cache: { find: () => null } } };

function makeChannel(id) {
  return {
    id,
    guild,
    isTextBased: () => true,
    send: async (payload) => {
      const body = normalize(payload);
      messageCount += 1;
      const message = { id: `m${messageCount}`, channelId: id, payload: body, at: Date.now(), edits: 0, deleted: false, pinged: pingsOf(body) };
      // An edit never pings again, in Discord or here.
      message.edit = async (next) => {
        if (message.deleted) throw unknownMessage();
        message.payload = { ...message.payload, ...normalize(next) };
        message.edits += 1;
        return message;
      };
      message.delete = async () => {
        if (message.deleted) throw unknownMessage();
        message.deleted = true;
      };
      messages.push(message);
      return message;
    },
    messages: {
      fetch: async (messageId) => messages.find((message) => message.id === messageId && !message.deleted) || Promise.reject(unknownMessage())
    }
  };
}
const channels = { room: makeChannel('room'), staff: makeChannel('staff') };
const client = { user: { id: 'bot' }, channels: { fetch: async (id) => channels[id] || null } };

// The people you can click as.
function people() {
  return {
    capA: { name: `${setup.teamA} captain`, roles: ['roleA'] },
    playerA: { name: `${setup.teamA} player`, roles: ['roleA'] },
    capB: { name: `${setup.teamB} captain`, roles: ['roleB'] },
    playerB: { name: `${setup.teamB} player`, roles: ['roleB'] },
    staff: { name: 'Staff member', roles: ['staffRole'], staff: true },
    outsider: { name: 'Someone on neither team', roles: [] }
  };
}

function member(id) {
  const person = people()[id];
  if (!person) return null;
  return {
    id,
    user: { id, username: person.name, globalName: person.name, bot: false },
    displayName: person.name,
    staff: Boolean(person.staff),
    roles: { cache: { has: (roleId) => person.roles.includes(roleId) } }
  };
}

// ---------- the bot's settings and the helpers src/index.js gives the veto ----------

// Copied from src/index.js (normalizeTeamKey, discordTimestamp, EMBED_COLORS).
const teamKey = (value) => String(value || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const deps = {
  EMBED_COLORS: { proposed: 0xf1c40f, accepted: 0x2ecc71, declined: 0xe74c3c, admin: 0x3498db, warning: 0xe67e22 },
  canUseBotAdminCommand: (who) => Boolean(who?.staff),
  discordTimestamp: (isoValue, style = 'F') => {
    const date = new Date(isoValue);
    return Number.isNaN(date.getTime()) ? null : `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
  },
  getAdminAllowedMentions: () => ({ parse: [], roles: ['staffRole'] }),
  getStaffMentions: () => '<@&staffRole>',
  getStoredMatchForChannel: (channel) => store.getStoredMatchByChannel(channel.id),
  isPlayoffMatch: () => true,
  normalizeConfiguredMatch: (match) => match,
  normalizeRoundCategory: (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
  normalizeTeamKey: teamKey,
  teamMappingScope: () => 'sim',
  truncateDiscordMessage: (value) => String(value).slice(0, 1900),
  upsertMatchIntroMessage: async () => {}
};

function makeConfig(settings) {
  return {
    faceitSources: [],
    vetoMapPool: settings.mapPool,
    vetoSeeds: new Map([[teamKey(settings.teamA), settings.seedA], [teamKey(settings.teamB), settings.seedB]]),
    vetoCaptainOnly: settings.captainOnly,
    vetoTurnSeconds: settings.turnSeconds,
    vetoNoticeMinutes: 60,
    vetoStartMinutes: 20,
    vetoSoonMinutes: 5,
    vetoAdvantageTeam: settings.format === 'bo5_advantage' ? (settings.advantageTeam === 'teamB' ? settings.teamB : settings.teamA) : '',
    vetoSidePolicy: undefined,
    vetoStaffChannelId: 'staff'
  };
}

// ---------- what the page can do ----------

async function currentVeto() {
  return matchId ? store.getVeto(matchId) : null;
}

async function schedule() {
  return matchId ? store.getSchedule(matchId) : null;
}

// One interaction, the way src/index.js hands it to src/veto.js. body.as is who clicks;
// body.messageId is the channel message the button is on; body.onReply means the button is on
// the "only you can see this" reply.
function interactionFor(body, label) {
  const who = people()[body.as] ? body.as : 'staff';
  const options = body.options || {};
  const source = body.messageId ? messages.find((message) => message.id === body.messageId) : null;
  const showReply = (payload) => { reply = { who, label, payload: normalize(payload), at: Date.now() }; };
  const state = { deferredUpdate: false };
  const interaction = {
    customId: body.customId || null,
    deferred: false,
    replied: false,
    user: { id: who, username: people()[who].name, globalName: people()[who].name },
    member: member(who),
    channel: channels.room,
    channelId: 'room',
    guild,
    options: {
      getString: (name) => (options[name] === undefined || options[name] === '' || options[name] === null ? null : String(options[name])),
      getInteger: (name) => (options[name] === undefined || options[name] === '' || options[name] === null ? null : Number(options[name])),
      getMember: (name) => (options[name] ? member(options[name]) : null),
      getChannel: () => null
    },
    deferReply: async () => { interaction.deferred = true; },
    deferUpdate: async () => { interaction.deferred = true; state.deferredUpdate = true; },
    reply: async (payload) => {
      interaction.replied = true;
      const message = normalize(payload);
      if (message.ephemeral) showReply(message);
      else await channels.room.send(message);
    },
    followUp: async (payload) => showReply(payload),
    // After deferUpdate, editReply edits the message the button is on; otherwise it is the reply.
    editReply: async (payload) => (state.deferredUpdate ? interaction.update(payload) : showReply(payload)),
    update: async (payload) => {
      interaction.replied = true;
      if (body.onReply && reply) reply = { ...reply, payload: { ...reply.payload, ...normalize(payload) } };
      else if (source) await source.edit(payload);
    }
  };
  return interaction;
}

async function run(interaction, handler) {
  try {
    await handler(interaction);
  } catch (error) {
    // What src/index.js answers when a handler throws (safelyRespondToInteraction).
    await (interaction.deferred || interaction.replied ? interaction.followUp : interaction.reply)({ content: `Something failed: ${error.message}`, ephemeral: true });
  }
}

// Clicks, commands and the clock checks run one at a time, like events in the live bot.
let queue = Promise.resolve();
const serial = (task) => {
  const next = queue.then(task, task);
  queue = next.catch(() => null);
  return next;
};

const actions = {
  async setup(body) {
    const pool = String(body.mapPool ?? DEFAULTS.mapPool).split(/[\s,;]+/).map((map) => map.trim()).filter(Boolean);
    setup = {
      teamA: String(body.teamA || '').trim() || DEFAULTS.teamA,
      teamB: String(body.teamB || '').trim() || DEFAULTS.teamB,
      seedA: Math.max(1, Number(body.seedA) || DEFAULTS.seedA),
      seedB: Math.max(1, Number(body.seedB) || DEFAULTS.seedB),
      format: body.format === 'bo5_advantage' ? 'bo5_advantage' : 'bo3',
      advantageTeam: body.advantageTeam === 'teamB' ? 'teamB' : 'teamA',
      mapPool: pool,
      turnSeconds: Math.max(10, Number(body.turnSeconds) || DEFAULTS.turnSeconds),
      captainOnly: Boolean(body.captainOnly),
      startsIn: Math.max(1, Number(body.startsIn) || DEFAULTS.startsIn)
    };
    if (teamKey(setup.teamA) === teamKey(setup.teamB)) throw new Error('The two teams need different names.');
    // A fresh start: new data file, new match, a new copy of the veto code (its timers and pings
    // for the old match are left behind and find nothing).
    fs.rmSync(DATA_PATH, { force: true });
    clockOffset = 0;
    messages.length = 0;
    reply = null;
    matchCount += 1;
    matchId = `sim-match-${matchCount}`;
    bot = createVetoBot({ client, config: makeConfig(setup), faceit: null, deps });
    await store.saveMatch({
      id: matchId,
      teamA: setup.teamA,
      teamB: setup.teamB,
      round: setup.format === 'bo5_advantage' ? 'Grand Final' : 'Upper Bracket Round 2',
      status: 'READY',
      source: { id: 'sim-playoffs', name: 'Playoffs' },
      faceitUrl: `https://www.faceit.com/en/cs2/room/${matchId}`
    }, { channelId: 'room', teamARoleId: 'roleA', teamBRoleId: 'roleB' });
    await store.saveTeamMapping('sim', { identity: 'sim-team-a', teamName: setup.teamA, captainDiscordIds: ['capA'] });
    await store.saveTeamMapping('sim', { identity: 'sim-team-b', teamName: setup.teamB, captainDiscordIds: ['capB'] });
    await store.saveSchedule(matchId, { matchId, adminApproved: true, scheduledAtIso: new Date(Date.now() + setup.startsIn * 60_000).toISOString() });
    await bot.tick(Date.now());
  },
  // Moves the clock forward a minute at a time, running the bot's once-a-minute check at each one
  // (as the live bot does), so the reminders go out in order. Stops when the veto starts.
  async skip(body) {
    if (!bot) throw new Error('Set up a match first.');
    if (vetoInProgress(await currentVeto())) throw new Error('The veto is running, and its turn clock runs in real time. To see a turn run out, set up the match again with fewer seconds per turn.');
    let minutes = Math.max(1, Math.min(24 * 60, Math.round(Number(body.minutes) || 1)));
    if (body.toStart) {
      const start = Date.parse((await schedule())?.scheduledAtIso || '');
      minutes = Math.ceil((start - 20 * 60_000 - Date.now()) / 60_000);
      if (!(minutes > 0)) throw new Error('It is already past the time the veto starts.');
    }
    for (let step = 0; step < minutes; step += 1) {
      clockOffset += 60_000;
      await bot.tick(Date.now());
      if (vetoInProgress(await currentVeto())) break;
    }
  },
  // A button on a message (or on the "only you can see this" reply), routed like src/index.js does.
  async click(body) {
    if (!bot) throw new Error('Set up a match first.');
    const id = String(body.customId || '');
    const interaction = interactionFor(body, `${people()[body.as]?.name || 'Staff member'} clicked "${body.label || id}"`);
    if (/^veto_(first|server|map|side):/.test(id)) await run(interaction, (it) => bot.handleChoice(it, id.slice(5, id.indexOf(':'))));
    else if (id.startsWith('veto_as:')) await run(interaction, (it) => bot.handleStaffChoice(it));
    else if (id.startsWith('veto_staff:')) await run(interaction, (it) => bot.handleStaffButton(it));
    else throw new Error('That button is not one of the veto buttons.');
  },
  // /cf veto action:... (staff only: Discord hides /cf from everyone else).
  async command(body) {
    if (!bot) throw new Error('Set up a match first.');
    const options = body.options || {};
    const label = `/cf veto action:${options.action}${options.user ? ` user:@${people()[options.user]?.name}` : ''}${options.maps ? ` maps:${options.maps}` : ''}${options.team_a_seed ? ` team_a_seed:${options.team_a_seed} team_b_seed:${options.team_b_seed}` : ''}`;
    const interaction = interactionFor(body, label);
    if (!interaction.member.staff) {
      reply = { who: body.as, label, payload: { content: 'Only staff can use /cf. (In Discord, players do not see the command at all.)' }, at: Date.now() };
      return;
    }
    await run(interaction, (it) => bot.handleAdmin(it));
  },
  // /crossfire veto: the status anyone in the match room can check.
  async status(body) {
    if (!bot) throw new Error('Set up a match first.');
    const veto = await currentVeto();
    const interaction = interactionFor(body, '/crossfire veto');
    await interaction.reply({ content: veto ? bot.formatStatus(veto) : 'No veto has started for this match.', ephemeral: true });
  },
  async closeReply() {
    reply = null;
  }
};

// ---------- the page ----------

function plain(message) {
  const embed = message.payload.embeds?.[0]?.data || message.payload.embeds?.[0] || null;
  return {
    id: message.id,
    channelId: message.channelId,
    at: message.at,
    edits: message.edits || 0,
    deleted: Boolean(message.deleted),
    pinged: message.pinged || [],
    content: message.payload.content || '',
    embed: embed ? { title: embed.title, description: embed.description || '', fields: embed.fields || [], color: embed.color, footer: embed.footer?.text || '' } : null,
    rows: (message.payload.components || []).map((row) => (row.components || []).map((button) => {
      const data = button.data || button;
      return { label: data.label, customId: data.custom_id, style: data.style, emoji: data.emoji?.name || '', disabled: Boolean(data.disabled) };
    }))
  };
}

async function view() {
  const veto = await currentVeto();
  const plan = await schedule();
  const startMs = Date.parse(plan?.scheduledAtIso || '');
  return {
    clock: Date.now(),
    setup: { ...setup, mapPool: setup.mapPool.join ? setup.mapPool.join(', ') : setup.mapPool },
    ready: Boolean(bot),
    matchAt: Number.isFinite(startMs) ? startMs : null,
    vetoStatus: veto?.status || null,
    paused: Boolean(veto?.pausedAt),
    people: Object.entries(people()).map(([id, person]) => ({ id, name: person.name })),
    names: {
      users: Object.fromEntries(Object.entries(people()).map(([id, person]) => [id, person.name])),
      roles: { roleA: setup.teamA, roleB: setup.teamB, staffRole: 'Staff' },
      channels: { room: `${teamKey(setup.teamA).replace(/ /g, '-')}-vs-${teamKey(setup.teamB).replace(/ /g, '-')}`, staff: 'veto-staff' }
    },
    messages: messages.map(plain),
    reply: reply ? { who: reply.who, label: reply.label, at: reply.at, ...plain({ id: 'reply', channelId: 'reply', payload: reply.payload, at: reply.at }) } : null,
    audit: matchId ? (await store.listAuditLog({ matchId })).slice(-40).reverse() : []
  };
}

async function handleRequest(request, response) {
  const url = new URL(request.url, 'http://localhost');
  if (request.method === 'GET' && url.pathname === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(fs.readFileSync(path.join(HERE, 'veto-sim.html'), 'utf8'));
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
      const action = actions[body.action];
      if (!action) throw new Error('Unknown action.');
      await serial(() => action(body));
    }
  } catch (caught) {
    error = caught.message;
  }
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ error, ...(await view()) }));
}

// The live bot checks once a minute; here it checks every few seconds so nothing waits.
setInterval(() => {
  if (bot) serial(() => bot.tick(Date.now())).catch((error) => console.error('Veto tick failed:', error.message));
}, 5_000).unref();

// Take the port before setup wipes the data file, so a second copy can't reset a running one.
// Windows answers "localhost" with ::1 before 127.0.0.1, so listen on both (this computer only).
await new Promise((resolve) => {
  http.createServer(handleRequest)
    .on('error', (error) => {
      console.error(error.code === 'EADDRINUSE'
        ? `Port ${PORT} is already in use. Is the simulator already running in another terminal? Close it, or set VETO_SIM_PORT to another port.`
        : `Could not start the simulator: ${error.message}`);
      process.exit(1);
    })
    .listen(PORT, '127.0.0.1', resolve);
});
http.createServer(handleRequest).on('error', () => {}).listen(PORT, '::1');
await actions.setup(DEFAULTS);
console.log(`Veto simulator: http://localhost:${PORT}  (keep this terminal open; Ctrl+C to stop)`);
