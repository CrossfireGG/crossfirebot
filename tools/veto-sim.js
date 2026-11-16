// Local veto simulator: click through a playoff veto in the browser, no Discord and no bot.
//   node tools/veto-sim.js        then open http://localhost:3210
// It runs the real rules from src/vetoEngine.js and shows the same message and buttons the bot
// posts in a match room (the text comes from the same functions; the layout is copied from
// vetoMessagePayload in src/index.js).
// Nothing is saved and nothing is sent anywhere.

import http from 'node:http';

import 'dotenv/config';

import { FaceitClient } from '../src/faceit.js';
import { derivePlayoffSeedMap } from '../src/playoffSeeds.js';

import { applyServerBan, applyVetoAction, chooseFirstAction, chooseSide, createVeto, expectedVetoAction, markTurnTimedOut, undoVeto, vetoCanUndo, pauseVeto, resumeVeto, turnLengthText, vetoActionLines, vetoFinalLines, vetoInProgress, vetoServerLines, vetoTurnAction, vetoTurnExpired, vetoTurnText } from '../src/vetoEngine.js';

const PORT = Number(process.env.VETO_SIM_PORT || 3210);
// A page left open from before a restart reloads itself instead of running old buttons.
const BUILD = String(Date.now());
const DEFAULTS = {
  teamA: 'EMPIRE',
  teamB: 'Old Meta',
  seedA: 9,
  seedB: 24,
  format: 'bo3',
  advantageTeam: 'teamA',
  mapPool: 'Dust2, Mirage, Nuke, Ancient, Inferno, Anubis, Cache',
  serverPool: 'Chicago, Denver, Dallas',
  captainOnly: true,
  turnSeconds: 120
};

// The real playoff matches, read from FACEIT with the bot's own key (FACEIT_API_KEY in .env), so
// a match can be picked from a list and its match room link shows on the veto like it does live.
const CHAMPIONSHIP = process.env.VETO_SIM_CHAMPIONSHIP || '946a3da3-c605-4b4c-a192-8806e63688f9';
let matchCache = { at: 0, items: [], error: null };
// Seeds worked out from the bracket the same way the bot does it (src/playoffSeeds.js).
let seedsByTeam = {};
const teamKey = (name) => String(name || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
let faceitUrl = null;

async function faceitMatches() {
  if (Date.now() - matchCache.at < 60_000) return matchCache.items;
  const key = process.env.FACEIT_API_KEY;
  if (!key) {
    matchCache = { at: Date.now(), items: [], error: 'FACEIT_API_KEY is not set in .env, so the match list is empty.' };
    return [];
  }
  const items = [];
  try {
    for (let offset = 0; offset < 300; offset += 100) {
      const response = await fetch(`https://open.faceit.com/data/v4/championships/${CHAMPIONSHIP}/matches?type=all&offset=${offset}&limit=100`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15_000)
      });
      if (!response.ok) throw new Error(`FACEIT answered HTTP ${response.status}`);
      const page = (await response.json()).items || [];
      for (const match of page) {
        const teamA = match.teams?.faction1?.name;
        const teamB = match.teams?.faction2?.name;
        if (!teamA || !teamB || /^(tbd|bye)$/i.test(teamA) || /^(tbd|bye)$/i.test(teamB)) continue;
        items.push({
          teamA,
          teamB,
          url: String(match.faceit_url || '').replace('{lang}', 'en'),
          status: match.status,
          scheduledAt: match.scheduled_at ? match.scheduled_at * 1000 : null,
          bestOf: match.best_of || null
        });
      }
      if (page.length < 100) break;
    }
    const source = { type: 'championship', id: CHAMPIONSHIP, name: 'Playoff Stage' };
    const derived = derivePlayoffSeedMap(await new FaceitClient(key, [source]).getMatchesForSource(source));
    seedsByTeam = {};
    for (const match of items) {
      for (const team of [match.teamA, match.teamB]) {
        const seed = derived.get(teamKey(team));
        if (seed) seedsByTeam[team.toLowerCase()] = seed;
      }
    }
    items.sort((a, b) => (a.status === 'FINISHED') - (b.status === 'FINISHED') || (a.scheduledAt || Infinity) - (b.scheduledAt || Infinity));
    matchCache = { at: Date.now(), items, error: null };
  } catch (error) {
    matchCache = { at: Date.now(), items: matchCache.items, error: `Could not read FACEIT: ${error.message}` };
  }
  return matchCache.items;
}

function faceitUrlFor(teamA, teamB) {
  const key = (name) => String(name || '').trim().toLowerCase();
  const pair = [key(teamA), key(teamB)].sort().join('|');
  return matchCache.items.find((match) => [key(match.teamA), key(match.teamB)].sort().join('|') === pair)?.url || null;
}

let veto = null;
let version = 0;
let log = [];
let lastSettings = {};

function start(options) {
  const settings = { ...DEFAULTS, ...options };
  lastSettings = options || {};
  const next = createVeto({
    match: { id: 'sim', teamA: String(settings.teamA).trim() || 'Team A', teamB: String(settings.teamB).trim() || 'Team B' },
    mapPool: String(settings.mapPool).split(',').map((map) => map.trim()).filter(Boolean),
    seeds: { teamA: Number(settings.seedA), teamB: Number(settings.seedB), source: 'simulator' },
    format: settings.format,
    advantageTeam: settings.format === 'bo5_advantage' ? settings.advantageTeam : null,
    captainOnly: Boolean(settings.captainOnly),
    turnSeconds: Math.max(5, Number(settings.turnSeconds) || 120),
    serverPool: String(settings.serverPool || '').split(',').map((server) => server.trim()).filter(Boolean)
  });
  veto = next;
  faceitUrl = faceitUrlFor(veto.teamA, veto.teamB);
  version += 1;
  // Log lines are text, or { only: 'before' | 'after', text } where the two layouts differ.
  const reminder = `1 hour before match time: 📢 @${veto.teamA} @${veto.teamB} Map veto reminder: the veto happens here in this channel, starting 20 minutes before match time. Team captains make the choices. Each turn has ${turnLengthText(veto)}.`;
  log = [
    { only: 'before', text: reminder },
    { only: 'after', text: `${reminder} Sides: when a team picks a map, the other team chooses its starting side; decider maps are a knife round.` },
    `Veto started (${settings.format === 'bo3' ? 'BO3' : 'Grand Final BO5'}). Both teams are pinged; each turn has ${turnLengthText(veto)}.`,
    { only: 'before', text: turnPing() }
  ];
}

// The "you're up" ping the bot posts each turn (and replaces on the next one).
function turnPing() {
  return `👉 @${nameOf(veto.currentTeam)} ${vetoTurnAction(veto).replace(/\*\*/g, '')}`;
}

// The bot's turn timer: when the time is up it pings the team and staff; nothing is chosen.
function tick() {
  if (!veto || !vetoTurnExpired(veto)) return;
  veto = markTurnTimedOut(veto);
  version += 1;
  log.push(`⏰ Time is up for ${nameOf(veto.currentTeam)} (${turnLengthText(veto)}). The team is pinged in the match room and staff are pinged in the staff channel.`);
}

function afterTurn() {
  version += 1;
  if (vetoInProgress(veto) && !veto.pausedAt) log.push(turnPing());
  if (veto.status === 'complete') log.push('Veto complete. The result is posted in the staff channel, in the match room (pinging both teams) and, for a main stream match, on the Schedule post (pinging the crew).');
}

// actor: 'teamA:captain' | 'teamA:player' | 'teamB:captain' | 'teamB:player' | 'staff' | 'none'
// Same checks, same wording as getVetoActorTeam + assertVetoActorEligible in the bot.
function actorTeam(actor) {
  const [team, rank] = String(actor || '').split(':');
  if (!['teamA', 'teamB'].includes(team)) throw new Error('You are not mapped to either team in this match.');
  // A stand-in (named by staff with /cf veto action:standin) acts like the captain.
  if (veto.captainOnly && !['captain', 'standin'].includes(rank)) throw new Error('Only the mapped captain for your team may act in this veto.');
  return team;
}

// Who the click counts for. Staff are asked to confirm in the page first (body.confirmed), then
// the choice is made for the team whose turn it is and their name is recorded.
function clicker(body, label) {
  if (body.actor !== 'staff') return { team: actorTeam(body.actor), staff: false };
  if (!vetoInProgress(veto) || veto.pausedAt) throw new Error('You are not mapped to either team in this match.');
  const team = veto.currentTeam;
  if (!body.confirmed) {
    const error = new Error(`Make this choice for ${nameOf(team)}? ${label(team)}`);
    error.confirm = true;
    throw error;
  }
  return { team, staff: true, label: label(team) };
}

function recordStaff(who) {
  if (!who.staff) return;
  veto = { ...veto, staffActions: [...(veto.staffActions || []), { staffId: 'Staff', team: who.team, label: who.label }] };
  log.push(`Staff made that choice for ${nameOf(who.team)} (named on the veto and in the audit log).`);
}

function nameOf(team) {
  return team === 'teamA' ? veto.teamA : veto.teamB;
}

function message() {
  if (!veto) return null;
  const actionLines = veto.actions.length ? vetoActionLines(veto).join('\n') : 'No map actions yet.';
  const final = veto.final ? vetoFinalLines(veto).join('\n') : null;
  const buttons = [];
  const staff = [];
  if (vetoInProgress(veto)) {
    staff.push(veto.pausedAt
      ? { kind: 'staff', value: 'resume', label: '▶️ Staff: Resume', style: 'success' }
      : { kind: 'staff', value: 'pause', label: '⏸️ Staff: Pause', style: 'secondary' });
  }
  if (vetoCanUndo(veto)) staff.push({ kind: 'staff', value: 'undo', label: '↩️ Staff: Undo last step', style: 'secondary' });
  if (vetoInProgress(veto)) staff.push({ kind: 'staff', value: 'reset', label: '🔄 Staff: Reset', style: 'secondary' });
  if (veto.pausedAt) {
    // Paused: nobody can choose, so only the staff row is shown.
  } else if (veto.status === 'choosing_first_action') {
    buttons.push({ kind: 'first', value: 'self', label: 'Our team acts first', style: 'primary' });
    buttons.push({ kind: 'first', value: 'opponent', label: 'Opponent acts first', style: 'secondary' });
  } else if (expectedVetoAction(veto) === 'server') {
    for (const server of veto.availableServers) buttons.push({ kind: 'server', value: server, label: `Ban ${server}`, style: 'danger' });
  } else if (veto.status === 'active' && veto.pendingSide) {
    buttons.push({ kind: 'side', value: 'CT', label: `Start CT on ${veto.pendingSide.map}`, style: 'primary' });
    buttons.push({ kind: 'side', value: 'T', label: `Start T on ${veto.pendingSide.map}`, style: 'secondary' });
  } else if (veto.status === 'active') {
    const banning = expectedVetoAction(veto) === 'ban';
    for (const map of veto.mapPool) {
      if (veto.availableMaps.includes(map)) buttons.push({ kind: 'map', value: map, label: `${banning ? 'Ban' : 'Pick'} ${map}`, style: banning ? 'danger' : 'success' });
    }
  }
  const fields = [
      { name: 'Map Pool Snapshot', value: veto.mapPool.join(', ') },
      { name: 'Seeds', value: `${veto.teamA}: #${veto.teamASeed}\n${veto.teamB}: #${veto.teamBSeed}\nSource: ${veto.seedSource}` },
      ...(veto.serverPool.length ? [{ name: `Server Location (${veto.serverPool.join(', ')})`, value: vetoServerLines(veto).join('\n') }] : []),
      { name: 'Actions', value: actionLines },
      final ? { name: 'Final Result', value: final, turn: true } : { name: 'Current Turn', value: vetoTurnText(veto), turn: true },
      { name: 'Side Policy', value: veto.sidePolicy },
      ...(veto.staffActions?.length ? [{ name: 'Chosen by staff', value: veto.staffActions.map((entry) => `@${entry.staffId} for **${nameOf(entry.team)}**: ${entry.label}`).join('\n') }] : []),
      { name: 'FACEIT', value: faceitUrl || 'Not linked' }
  ];
  // The proposed trimmed layout: no Side Policy, no "Source:" line. (Map Pool Snapshot stays.)
  const fieldsAfter = fields
    .filter((field) => field.name !== 'Side Policy')
    .map((field) => (field.name === 'Seeds' ? { ...field, value: `${veto.teamA}: #${veto.teamASeed}\n${veto.teamB}: #${veto.teamBSeed}` } : field));
  return {
    version,
    status: veto.status,
    currentTeam: veto.currentTeam,
    higherSeedTeam: veto.higherSeedTeam,
    teamA: veto.teamA,
    teamB: veto.teamB,
    captainOnly: veto.captainOnly,
    complete: veto.status === 'complete',
    paused: Boolean(veto.pausedAt),
    title: veto.status === 'complete' ? 'Discord Veto Complete' : veto.pausedAt ? 'CROSSFIRE Playoff Veto (paused)' : 'CROSSFIRE Playoff Veto',
    description: `**${veto.teamA} vs ${veto.teamB}**`,
    fields,
    fieldsAfter,
    footer: 'Discord veto only. Staff must enter the result into FACEIT.',
    buttons,
    staff,
    log
  };
}

const routes = {
  'POST /api/start': async (body) => {
    await faceitMatches();
    start(body);
  },
  // The playoff matches to choose from, and the seed of every team.
  'GET /api/matches': async () => ({
    matches: await faceitMatches(),
    matchesError: matchCache.error,
    seeds: seedsByTeam
  }),
  'POST /api/first': (body) => {
    const who = clicker(body, (side) => `${nameOf(body.choice === 'self' ? side : side === 'teamA' ? 'teamB' : 'teamA')} acts first`);
    const team = who.team;
    veto = chooseFirstAction(veto, team, body.choice);
    log.push(`${nameOf(team)} chose: ${body.choice === 'self' ? 'we act first' : 'opponent acts first'}.`);
    recordStaff(who);
    afterTurn();
  },
  'POST /api/map': (body) => {
    const action = expectedVetoAction(veto);
    const who = clicker(body, () => `${action === 'pick' ? 'Pick' : 'Ban'} ${body.map}`);
    const team = who.team;
    veto = applyVetoAction(veto, team, body.map);
    log.push(`${nameOf(team)} ${action === 'ban' ? 'banned' : 'picked'} ${body.map}.`);
    recordStaff(who);
    afterTurn();
  },
  'POST /api/server': (body) => {
    const who = clicker(body, () => `Ban the ${body.server} server`);
    const team = who.team;
    veto = applyServerBan(veto, team, body.server);
    log.push(`${nameOf(team)} banned the ${body.server} server.${veto.server ? ` The match is played on ${veto.server}; the match info message now shows it.` : ''}`);
    recordStaff(who);
    afterTurn();
  },
  'POST /api/side': (body) => {
    const map = veto.pendingSide?.map;
    const who = clicker(body, () => `Start ${body.side} on ${map}`);
    const team = who.team;
    veto = chooseSide(veto, team, body.side);
    log.push(`${nameOf(team)} chose to start ${body.side} on ${map}.`);
    recordStaff(who);
    afterTurn();
  },
  // The staff row: pause, resume, reset. Same refusal as the bot for anyone who isn't staff.
  'POST /api/staff': (body) => {
    if (body.actor !== 'staff') throw new Error('Only staff can use the staff buttons on the veto.');
    if (body.action === 'reset') {
      start(lastSettings);
      log.unshift('Staff reset the veto.');
      return;
    }
    if (body.action === 'undo') {
      veto = undoVeto(veto);
      log.push('Staff took back the last step.');
      afterTurn();
      return;
    }
    veto = body.action === 'pause' ? pauseVeto(veto) : resumeVeto(veto);
    log.push(body.action === 'pause' ? 'Staff paused the veto. The clock is stopped.' : `Staff resumed the veto. ${nameOf(veto.currentTeam)} has the full ${turnLengthText(veto)} again.`);
    afterTurn();
  },
  'GET /api/state': () => null
};

const server = http.createServer(async (request, response) => {
  const key = `${request.method} ${request.url.split('?')[0]}`;
  if (key === 'GET /') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(PAGE.replace('__DEFAULTS__', JSON.stringify(DEFAULTS)).replace('__BUILD__', BUILD));
    return;
  }
  const handler = routes[key];
  if (!handler) {
    response.writeHead(404).end('Not found');
    return;
  }
  let raw = '';
  for await (const chunk of request) raw += chunk;
  let error = null;
  let confirmText = null;
  let extra = null;
  try {
    const body = raw ? JSON.parse(raw) : {};
    if (!['POST /api/start', 'GET /api/state', 'GET /api/matches'].includes(key) && !veto) throw new Error('Start a veto first.');
    tick();
    extra = await handler(body);
  } catch (caught) {
    error = caught.message;
    if (caught.confirm) confirmText = caught.message;
  }
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ build: BUILD, error: confirmText ? null : error, confirm: confirmText, message: message(), ...(extra || {}) }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Veto simulator: http://localhost:${PORT}  (Ctrl+C to stop)`);
});

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Veto simulator</title>
<style>
  :root { --bg:#313338; --side:#2b2d31; --card:#2b2d31; --text:#dbdee1; --muted:#949ba4; --line:#3f4147; --blurple:#5865f2; --grey:#4e5058; --green:#2ecc71; --red:#f23f43; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.4 "gg sans","Segoe UI",system-ui,sans-serif; display:flex; min-height:100vh; }
  aside { width:310px; flex:none; background:var(--side); padding:16px; border-right:1px solid var(--line); }
  main { flex:1; padding:20px 24px; min-width:0; }
  h1 { font-size:16px; margin:0 0 4px; }
  h2 { font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin:18px 0 8px; }
  p.note { color:var(--muted); font-size:13px; margin:0 0 8px; }
  label { display:block; font-size:12px; color:var(--muted); margin:8px 0 3px; }
  input[type=text], input[type=number], select { width:100%; background:#1e1f22; color:var(--text); border:1px solid var(--line); border-radius:4px; padding:7px 8px; font:inherit; }
  .row { display:flex; gap:8px; } .row > div { flex:1; min-width:0; }
  .check { display:flex; align-items:center; gap:8px; margin-top:10px; font-size:14px; color:var(--text); }
  button { font:inherit; font-weight:500; color:#fff; border:0; border-radius:4px; padding:8px 14px; cursor:pointer; }
  button.primary { background:var(--blurple); } button.secondary { background:var(--grey); }
  button.danger { background:#da373c; } button.success { background:#248046; }
  button:hover { filter:brightness(1.1); }
  #start { width:100%; margin-top:14px; }
  .actors { display:grid; gap:6px; }
  .actors button { text-align:left; background:#1e1f22; border:1px solid var(--line); color:var(--text); }
  .actors button.on { border-color:var(--blurple); background:#3c4270; color:#fff; }
  .actors button.turn::after { content:"  ← their turn"; color:var(--green); font-size:12px; }
  .channel { color:var(--muted); font-size:13px; margin-bottom:14px; }
  .msg { display:flex; gap:14px; max-width:720px; }
  .avatar { width:40px; height:40px; border-radius:50%; background:#ff5500; flex:none; display:grid; place-items:center; font-weight:700; color:#fff; }
  .who { font-weight:600; } .tag { background:var(--blurple); color:#fff; font-size:10px; border-radius:3px; padding:1px 5px; margin-left:6px; vertical-align:middle; }
  .embed { margin-top:6px; background:var(--card); border-left:4px solid var(--blurple); border-radius:4px; padding:12px 16px; }
  .embed.done { border-left-color:var(--green); }
  .embed .title { font-weight:700; font-size:16px; margin-bottom:6px; }
  .field { margin-top:10px; } .field .name { font-weight:700; font-size:14px; } .field .value { white-space:pre-wrap; font-size:14px; }
  .footer { margin-top:12px; font-size:12px; color:var(--muted); }
  .buttons { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; max-width:520px; }
  .embed.paused { border-left-color:#f1c40f; }
  .clock { font-weight:700; background:#1e1f22; border-radius:3px; padding:0 4px; }
  .clock.low { color:#f23f43; }
  .eph { margin-top:12px; max-width:720px; background:#3a2a2c; border-left:4px solid var(--red); border-radius:4px; padding:8px 12px; font-size:14px; }
  .eph small { display:block; color:var(--muted); margin-top:2px; }
  .log { margin-top:22px; color:var(--muted); font-size:13px; max-width:720px; } .log div { padding:2px 0; }
  .empty { color:var(--muted); }
  .cols { display:grid; grid-template-columns:1fr 1fr; gap:28px; align-items:start; }
  .col > h3 { margin:0 0 10px; font-size:12px; letter-spacing:.05em; text-transform:uppercase; padding:4px 8px; border-radius:4px; display:inline-block; }
  .col.before > h3 { background:#4e5058; color:#fff; } .col.after > h3 { background:#248046; color:#fff; }
  .diffs { margin-top:26px; max-width:980px; border-top:1px solid var(--line); padding-top:14px; font-size:14px; }
  .diffs table { border-collapse:collapse; width:100%; } .diffs td, .diffs th { text-align:left; vertical-align:top; padding:6px 10px 6px 0; border-bottom:1px solid var(--line); }
  .diffs th { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.04em; }
  .pill { font-size:11px; border-radius:3px; padding:1px 6px; background:#1e1f22; color:var(--muted); white-space:nowrap; }
  @media (max-width: 1150px) { .cols { grid-template-columns:1fr; } }
  @media (max-width: 760px) { body { flex-direction:column; } aside { width:auto; border-right:0; border-bottom:1px solid var(--line); } }
</style>
</head>
<body>
<aside>
  <h1>Veto simulator</h1>
  <p class="note">Runs the bot's real veto rules. Nothing is posted to Discord.</p>

  <h2>Match</h2>
  <label>Playoff match from FACEIT</label>
  <select id="matchPick"><option value="">Loading matches…</option></select>
  <p class="note" id="matchNote" style="margin-top:6px"></p>
  <div class="row">
    <div><label>Team A</label><input type="text" id="teamA"></div>
    <div style="flex:0 0 70px"><label>Seed</label><input type="number" id="seedA" min="1"></div>
  </div>
  <div class="row">
    <div><label>Team B</label><input type="text" id="teamB"></div>
    <div style="flex:0 0 70px"><label>Seed</label><input type="number" id="seedB" min="1"></div>
  </div>
  <label>Format</label>
  <select id="format">
    <option value="bo3">BO3 (ban ban pick pick ban ban)</option>
    <option value="bo5_advantage">Grand Final BO5 (upper-bracket advantage)</option>
  </select>
  <div id="advWrap"><label>Upper-bracket winner</label>
    <select id="advantageTeam"><option value="teamA">Team A</option><option value="teamB">Team B</option></select></div>
  <label>Map pool (exactly 7, comma separated)</label>
  <input type="text" id="mapPool">
  <label>Server locations (comma separated, empty = none)</label>
  <input type="text" id="serverPool">
  <label>Seconds per turn (live: 120)</label>
  <input type="number" id="turnSeconds" min="5">
  <label class="check"><input type="checkbox" id="captainOnly"> Captains only</label>
  <button class="primary" id="start">Start / reset veto</button>

  <h2>You are clicking as</h2>
  <div class="actors" id="actors"></div>
</aside>
<main>
  <div class="channel"># sample-match-room · the same veto shown two ways; buttons in either column do the same thing</div>
  <div id="empty" class="empty">Press <b>Start / reset veto</b> to post the veto message.</div>
  <div class="cols" id="cols" style="display:none">
    <div class="col before"><h3>Before (current)</h3><div id="view-before"></div><div class="log" id="log-before"></div></div>
    <div class="col after"><h3>After (trimmed)</h3><div id="view-after"></div><div class="log" id="log-after"></div></div>
  </div>
  <div id="eph"></div>
  <div class="diffs">
    <h2>Differences</h2>
    <table>
      <tr><th>Change</th><th>Before</th><th>After</th><th>Where to see it</th></tr>
      <tr><td>Side Policy field</td><td>The same sentence on every veto message</td><td>Removed from the message; the sentence is in the 1-hour reminder</td><td><span class="pill">message</span> <span class="pill">What happened</span></td></tr>
      <tr><td>"Source:" line under Seeds</td><td>Seeds plus "Source: ..."</td><td>The two seed numbers only</td><td><span class="pill">message</span></td></tr>
      <tr><td>Ping when the veto starts</td><td>Both teams pinged, then the first team pinged again a second later</td><td>Both teams pinged once; turn pings start from the second turn</td><td><span class="pill">What happened</span></td></tr>
      <tr><td><code>/cf veto action:cancel</code></td><td>Ends the veto and blocks the automatic start</td><td>Removed; staff use pause or reset</td><td><span class="pill">command, not shown here</span></td></tr>
      <tr><td><code>/cf veto action:inspect</code></td><td>Shows the veto status to staff</td><td>Removed; <code>/crossfire veto</code> shows the same</td><td><span class="pill">command, not shown here</span></td></tr>
      <tr><td>Railway variables</td><td><code>VETO_SIDE_POLICY</code>, <code>VETO_ADVANTAGE_TEAM</code>, <code>VETO_SEEDS</code></td><td>Removed; built-in side rule, the seed list, and <code>/cf veto action:seeds</code> (also sets the Grand Final advantage team)</td><td><span class="pill">setting, not shown here</span></td></tr>
    </table>
  </div>
</main>
<script>
const defaults = __DEFAULTS__;
const $ = (id) => document.getElementById(id);
let actor = 'teamA:captain';
let current = null;

for (const key of ['teamA', 'teamB', 'seedA', 'seedB', 'format', 'advantageTeam', 'mapPool', 'serverPool', 'turnSeconds']) $(key).value = defaults[key];
$('captainOnly').checked = defaults.captainOnly;
const showAdv = () => { $('advWrap').style.display = $('format').value === 'bo5_advantage' ? '' : 'none'; };
$('format').onchange = showAdv; showAdv();

function esc(text) { const d = document.createElement('div'); d.textContent = text; return d.innerHTML; }
function md(text) {
  return esc(text).replace(/\\*\\*(.+?)\\*\\*/g, '<b>$1</b>')
    .replace(/&lt;t:(\\d+):R&gt;/g, '<span class="clock" data-t="$1"></span>')
    .replace(new RegExp('(https:[^ <]+)', 'g'), '<a href="$1" target="_blank" rel="noopener" style="color:#00a8fc">$1</a>');
}
// Discord shows <t:...:R> as a live "in 2 minutes"; here it is a countdown.
function paintClocks() {
  for (const el of document.querySelectorAll('.clock')) {
    const left = Math.ceil(Number(el.dataset.t) - Date.now() / 1000);
    el.textContent = left > 0 ? 'in ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') : 'now';
    el.className = 'clock' + (left <= 30 ? ' low' : '');
  }
}
setInterval(paintClocks, 250);

function renderActors() {
  const a = current ? current.teamA : $('teamA').value, b = current ? current.teamB : $('teamB').value;
  const list = [['teamA:captain', a + ' captain'], ['teamA:player', a + ' player (not captain)'], ['teamB:captain', b + ' captain'], ['teamB:player', b + ' player (not captain)'], ['teamA:standin', a + ' stand-in captain (named by staff)'], ['teamB:standin', b + ' stand-in captain (named by staff)'], ['staff', 'Staff / admin'], ['none', 'Someone not in the match']];
  const turn = current && !current.complete && !current.paused ? current.currentTeam + ':captain' : null;
  $('actors').innerHTML = '';
  for (const [value, label] of list) {
    const button = document.createElement('button');
    button.textContent = label;
    button.className = (value === actor ? 'on ' : '') + (value === turn ? 'turn' : '');
    button.onclick = () => { actor = value; renderActors(); };
    $('actors').appendChild(button);
  }
}

function paint(which, message, fields) {
  const view = $('view-' + which);
  const html = fields.map((f) => '<div class="field"><div class="name">' + esc(f.name) + '</div><div class="value">' + md(f.value) + '</div></div>').join('');
  view.innerHTML = '<div class="msg"><div class="avatar">CF</div><div style="min-width:0;flex:1"><span class="who">CROSSFIRE Bot</span><span class="tag">APP</span>'
    + '<div class="embed' + (message.complete ? ' done' : message.paused ? ' paused' : '') + '"><div class="title">' + esc(message.title) + '</div><div>' + md(message.description) + '</div>' + html
    + '<div class="footer">' + esc(message.footer) + '</div></div><div class="buttons"></div><div class="buttons"></div></div></div>';
  const [teamRow, staffRow] = view.querySelectorAll('.buttons');
  for (const b of message.buttons) {
    const button = document.createElement('button');
    button.className = b.style;
    button.textContent = b.label;
    button.onclick = () => call('/api/' + b.kind, b.kind === 'first' ? { actor, choice: b.value } : b.kind === 'side' ? { actor, side: b.value } : b.kind === 'server' ? { actor, server: b.value } : { actor, map: b.value });
    teamRow.appendChild(button);
  }
  for (const b of message.staff) {
    const button = document.createElement('button');
    button.className = b.style;
    button.textContent = b.label;
    button.onclick = () => {
      if (b.value === 'reset' && actor === 'staff' && !confirm('Reset the veto? Everything chosen so far is cleared and the veto starts again.')) return;
      call('/api/staff', { actor, action: b.value });
    };
    staffRow.appendChild(button);
  }
  const lines = message.log.filter((line) => typeof line === 'string' || line.only === which).map((line) => (typeof line === 'string' ? line : line.text));
  $('log-' + which).innerHTML = '<h2>What happened</h2>' + lines.map((line) => '<div>' + esc(line) + '</div>').join('');
}

function render(message) {
  current = message;
  renderActors();
  if (!message) return;
  $('empty').style.display = 'none';
  $('cols').style.display = '';
  paint('before', message, message.fields);
  paint('after', message, message.fieldsAfter);
  paintClocks();
}

async function call(path, body) {
  const response = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await response.json();
  if (data.build !== '__BUILD__') { location.reload(); return; }
  // Staff clicking a team button: the bot asks first, then makes the choice for that team.
  if (data.confirm) {
    if (confirm(data.confirm + ' Only do this on the word of the team. Your name goes on the veto.')) return call(path, { ...body, confirmed: true });
    render(data.message);
    return;
  }
  $('eph').innerHTML = data.error ? '<div class="eph">' + esc(data.error) + '<small>Only you can see this</small></div>' : '';
  render(data.message);
}
// The time-up ping arrives on its own, like in Discord.
setInterval(async () => {
  if (!current || current.complete || current.paused) return;
  const data = await (await fetch('/api/state')).json();
  if (data.build !== '__BUILD__') { location.reload(); return; }
  if (data.message && data.message.version !== current.version) render(data.message);
}, 1000);

$('start').onclick = () => call('/api/start', {
  teamA: $('teamA').value, teamB: $('teamB').value, seedA: $('seedA').value, seedB: $('seedB').value,
  format: $('format').value, advantageTeam: $('advantageTeam').value, mapPool: $('mapPool').value, serverPool: $('serverPool').value, captainOnly: $('captainOnly').checked, turnSeconds: $('turnSeconds').value
});
call('/api/state');

// The real playoff matches: choosing one fills in the teams and their seeds, and the veto then
// shows that match's FACEIT room link.
(async () => {
  const data = await (await fetch('/api/matches')).json();
  const pick = $('matchPick');
  const when = (ms) => ms ? new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' }) + ' ET' : 'no time yet';
  pick.innerHTML = '';
  pick.add(new Option(data.matches.length ? 'Choose a match…' : 'No matches found', ''));
  data.matches.forEach((match, index) => pick.add(new Option(match.teamA + ' vs ' + match.teamB + ' · ' + (match.status === 'FINISHED' ? 'finished' : when(match.scheduledAt)), String(index))));
  $('matchNote').textContent = data.matchesError || '';
  pick.onchange = () => {
    const match = data.matches[Number(pick.value)];
    if (!pick.value || !match) return;
    $('teamA').value = match.teamA;
    $('teamB').value = match.teamB;
    const seedA = data.seeds[match.teamA.toLowerCase()], seedB = data.seeds[match.teamB.toLowerCase()];
    if (seedA) $('seedA').value = seedA;
    if (seedB) $('seedB').value = seedB;
    $('format').value = match.bestOf === 5 ? 'bo5_advantage' : 'bo3';
    showAdv();
    renderActors();
    $('matchNote').textContent = 'Press Start / reset veto to use this match.';
  };
})();
</script>
</body>
</html>`;
