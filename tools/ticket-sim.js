// Local ticket simulator: open, work and close support tickets in the browser, no Discord and
// no bot.
//   node tools/ticket-sim.js        then open http://localhost:3211
// It uses the real rules and text from src/tickets.js (topics, priorities, the ticket header, the
// staff alert, channel names, the transcript). The forms and the Discord flow around them are
// copied from src/index.js. Not simulated: the roster editor (it works on the Google Sheet) and
// FACEIT lookups (pick what FACEIT "says" in the left panel instead).
// Nothing is saved and nothing is sent anywhere.

import http from 'node:http';

import {
  ARENA_APPEAL_TYPES,
  ARENA_LINK_ISSUES,
  ARENA_LIVE_PROBLEMS,
  ARENA_REPORT_REASONS,
  ARENA_TICKET_KINDS,
  LEAGUE_TICKET_KINDS,
  MATCH_STATES,
  PRIORITIES,
  TICKET_SUBJECTS,
  arenaTicketKind,
  arenaTicketPriority,
  buildTicketHeader,
  buildTranscript,
  matchIssuePriority,
  rosterPriority,
  splitNames,
  ticketAlertText,
  ticketChannelName,
  ticketNumberText,
  ticketTopicLabel
} from '../src/tickets.js';

const PORT = Number(process.env.TICKET_SIM_PORT || 3211);
const BUILD = String(Date.now());

// Who you can click as. kind: 'player' | 'staff' (Tournament Operations / admins) | 'arena'
// (Arena Admin / Arena Operations: Arena tickets only).
const PEOPLE = {
  zoro: { name: 'Zoro', kind: 'player', note: 'a player' },
  steel: { name: 'steel', kind: 'player', note: 'another player' },
  crown: { name: 'Crown', kind: 'staff', note: 'staff' },
  matt: { name: 'BignTallMatt', kind: 'staff', note: 'staff' },
  nova: { name: 'Nova', kind: 'arena', note: 'Arena staff' }
};
const ROLES = { ops: 'Tournament Operations', arena: 'Arena', admins: 'League Admins' };
const APPLY_ROLES = ['Caster', 'Producer', 'Observer', 'Admin', 'Social Media', 'Other'];

// The forms, as the bot asks them (ticketModal / arenaTicketModal in src/index.js).
const text = (id, label, extra = {}) => ({ id, label, type: 'text', required: true, ...extra });
const para = (id, label, extra = {}) => ({ id, label, type: 'para', required: true, ...extra });
const pick = (id, label, options) => ({ id, label, type: 'select', required: true, options: options.map((option) => (typeof option === 'string' ? { label: option, value: option } : option)) });
const matchLink = (required) => text('match', required ? 'FACEIT match link' : 'FACEIT match link (if you have it)', { required, placeholder: 'https://www.faceit.com/en/cs2/room/...' });
const FORMS = {
  support: { title: 'General Support', fields: [
    para('help', 'What do you need help with?'),
    text('team', 'Your team (if it is about a team)', { required: false }),
    text('link', 'Screenshot or link (optional)', { required: false, placeholder: 'You can also post screenshots in the ticket' })
  ] },
  match: { title: 'Match / FACEIT Issue', fields: [
    text('team', 'Your team'),
    text('match', 'Match link (FACEIT room)', { placeholder: 'https://www.faceit.com/en/cs2/room/...' }),
    para('what', "What's happening?"),
    pick('state', 'Is the match live?', MATCH_STATES)
  ] },
  apply: { title: 'Apply to Crossfire', fields: [
    pick('role', 'What are you applying for?', APPLY_ROLES),
    para('experience', 'Relevant experience'),
    para('links', 'Links (portfolio, channel, VODs…)', { required: false })
  ] },
  roster: { title: 'Roster Change', fields: [text('team', 'Team name on FACEIT')] },
  'arena:report': { title: 'Arena: Report a player', fields: [
    matchLink(true),
    text('who', 'Who are you reporting? (FACEIT names)', { placeholder: 'One or more names, separated by commas' }),
    pick('reason', 'Reason', ARENA_REPORT_REASONS),
    para('what', 'What happened?', { placeholder: 'Round numbers / timestamps help a lot' }),
    para('evidence', 'Clips or demo links (optional)', { required: false, placeholder: 'You can also post them in the ticket' })
  ] },
  'arena:live': { title: 'Arena: Live game problem', fields: [
    matchLink(false),
    pick('problem', "What's wrong?", ARENA_LIVE_PROBLEMS),
    para('details', 'Details', { required: false })
  ] },
  'arena:appeal': { title: 'Arena: Appeal', fields: [
    text('faceit', 'Your FACEIT name'),
    pick('type', 'What are you appealing?', ARENA_APPEAL_TYPES),
    text('when', 'When / which match (optional)', { required: false, placeholder: 'Date, or the FACEIT match link' }),
    para('why', 'Why should it be lifted?')
  ] },
  'arena:link': { title: 'Arena: FACEIT link / voice help', fields: [
    text('faceit', 'Your FACEIT name or profile link'),
    pick('issue', "What's the problem?", ARENA_LINK_ISSUES),
    para('details', 'Details (optional)', { required: false })
  ] }
};

// What the bot would find out by itself. Set from the left panel.
const settings = {
  staffOnly: false, // TICKETS_STAFF_ONLY
  faceitStatus: '', // what FACEIT says about the match link: '', 'ONGOING', 'READY', 'FINISHED'
  rosterNext: 'soon' // the team's next match: 'soon' (within 24 h), 'later', 'none', 'unknown'
};

let tickets = [];
let receipts = [];
let nextNumber = 41;
let version = 0;

const isStaff = (person) => person?.kind === 'staff';
const canHandle = (person, ticket) => isStaff(person) || (ticket.topic === 'arena' && person?.kind === 'arena');
const canSee = (person, ticket) => ticket.openerId === person.id || canHandle(person, ticket);

function say(ticket, author, content, extra = {}) {
  ticket.messages.push({ createdAt: Date.now(), author, content, attachments: [], embeds: [], ...extra });
}

function openTicket(person, formKey, values) {
  const form = FORMS[formKey];
  if (!form) throw new Error('Unknown form.');
  for (const field of form.fields) {
    if (field.required && !String(values[field.id] || '').trim()) throw new Error(`"${field.label}" is required.`);
  }
  const value = (id) => String(values[id] || '').trim();
  const label = (id) => form.fields.find((field) => field.id === id)?.options?.find((option) => option.value === value(id))?.label || value(id);
  const topic = formKey.startsWith('arena:') ? 'arena' : formKey;
  const arenaKind = formKey.startsWith('arena:') ? formKey.slice(6) : null;
  let answers;
  let priority = { priority: 'normal', reason: null };
  let adminPings = false;
  let note = null;
  const extra = {};

  if (topic === 'support') {
    answers = [
      { label: 'What they need help with', value: value('help') },
      { label: 'Team', value: value('team') },
      { label: 'Screenshot or link', value: value('link') }
    ];
  } else if (topic === 'match') {
    const result = matchIssuePriority({ state: value('state'), faceitStatus: settings.faceitStatus || null });
    priority = { priority: result.priority, reason: result.reason };
    adminPings = result.pingAdmins;
    answers = [
      { label: 'Team', value: value('team') },
      { label: 'Match', value: settings.faceitStatus ? `${value('match')} · FACEIT: ${settings.faceitStatus.toLowerCase()}` : value('match') },
      { label: "What's happening", value: value('what') },
      { label: 'Match state', value: label('state') }
    ];
  } else if (topic === 'apply') {
    answers = [
      { label: 'Applying for', value: value('role') },
      { label: 'Discord', value: `<@${person.id}> (${person.name})` },
      { label: 'Experience', value: value('experience') },
      { label: 'Links', value: value('links') }
    ];
  } else if (topic === 'roster') {
    const now = Date.now();
    const lookup = settings.rosterNext === 'unknown'
      ? { ok: false }
      : { ok: true, startMs: settings.rosterNext === 'soon' ? now + 6 * 60 * 60 * 1000 : settings.rosterNext === 'later' ? now + 4 * 24 * 60 * 60 * 1000 : null };
    priority = rosterPriority(lookup, now);
    extra.teamName = value('team');
    extra.nextMatchIso = lookup.ok && lookup.startMs ? new Date(lookup.startMs).toISOString() : null;
    answers = [
      { label: 'Team', value: value('team') },
      { label: 'Next match', value: lookup.ok ? (lookup.startMs ? `<t:${Math.floor(lookup.startMs / 1000)}:R>` : 'None scheduled') : "Couldn't be read" }
    ];
    note = 'In Discord the roster from the sheet appears here with buttons to add, remove, bench or promote players. That editor is not part of this simulator.';
  } else {
    const result = arenaTicketPriority({ kind: arenaKind, reason: value('reason') || null, faceitStatus: settings.faceitStatus || null });
    priority = { priority: result.priority, reason: result.reason };
    if (arenaKind === 'report') {
      answers = [
        { label: 'Match', value: value('match') },
        { label: 'Reported', value: splitNames(value('who')).join(', ') },
        { label: 'Reason', value: value('reason') },
        { label: 'What happened', value: value('what') },
        { label: 'Evidence', value: value('evidence') }
      ];
    } else if (arenaKind === 'live') {
      answers = [
        { label: 'Match', value: value('match') },
        { label: "What's wrong", value: value('problem') },
        { label: 'Details', value: value('details') }
      ];
    } else if (arenaKind === 'appeal') {
      answers = [
        { label: 'FACEIT', value: value('faceit') },
        { label: 'Appealing', value: value('type') },
        { label: 'When / which match', value: value('when') },
        { label: 'Why it should be lifted', value: value('why') }
      ];
    } else {
      answers = [
        { label: 'FACEIT', value: value('faceit') },
        { label: 'Problem', value: value('issue') },
        { label: 'Details', value: value('details') }
      ];
    }
  }

  const number = (nextNumber += 1);
  const ticket = {
    id: `t${number}`,
    number,
    topic,
    arenaKind,
    openerId: person.id,
    openerTag: person.name,
    answers,
    priority: priority.priority,
    priorityReason: priority.reason || null,
    priorityOverride: false,
    needsVerify: Boolean(priority.needsVerify),
    status: 'open',
    claimedBy: null,
    claimedTag: null,
    createdAt: new Date().toISOString(),
    adminPingUserIds: [],
    adminPingRoleIds: adminPings ? ['admins'] : [],
    messages: [],
    ...extra
  };
  ticket.channelId = ticket.id;
  ticket.channelName = ticketChannelName(topic, number, person.name, arenaKind ? arenaTicketKind(arenaKind)?.prefix : null);
  say(ticket, 'CROSSFIRE Bot', [
    `<@${person.id}>`,
    adminPings ? '🔴 **Priority support:** this match is live or about to start, and the admins have been alerted.' : null,
    note
  ].filter(Boolean).join(' '), { embeds: [`Ticket ${ticketNumberText(number)}`] });
  tickets.push(ticket);
  return ticket;
}

// What each person can see, like channel permissions in Discord.
function view(personId) {
  const person = { id: personId, ...(PEOPLE[personId] || PEOPLE.zoro) };
  const mine = tickets.filter((ticket) => ticket.status === 'open' && canSee(person, ticket));
  const alertFor = (ticket) => ({
    id: ticket.id,
    text: ticketAlertText(ticket, { roleIds: [ticket.topic === 'arena' ? 'arena' : 'ops'] }),
    open: ticket.status === 'open',
    claimed: Boolean(ticket.claimedBy),
    channelName: ticket.channelName
  });
  return {
    build: BUILD,
    version,
    me: person,
    settings,
    people: Object.entries(PEOPLE).map(([id, entry]) => ({ id, ...entry })),
    roles: ROLES,
    subjects: TICKET_SUBJECTS,
    leagueKinds: LEAGUE_TICKET_KINDS,
    arenaKinds: ARENA_TICKET_KINDS,
    forms: FORMS,
    priorities: PRIORITIES,
    staff: Object.entries(PEOPLE).filter(([, entry]) => entry.kind === 'staff').map(([id, entry]) => ({ id, name: entry.name })),
    channelNames: Object.fromEntries(tickets.map((ticket) => [ticket.id, ticket.channelName])),
    tickets: mine.map((ticket) => ({
      id: ticket.id,
      channelName: ticket.channelName,
      topicLine: `${ticketNumberText(ticket.number)} · ${ticketTopicLabel(ticket)} · opened by ${ticket.openerTag}`,
      header: buildTicketHeader(ticket),
      priority: ticket.priority,
      claimed: Boolean(ticket.claimedBy),
      canHandle: canHandle(person, ticket),
      messages: ticket.messages
    })),
    // The alert channels: Tournament Operations for league tickets, the Arena channel for Arena ones.
    alerts: isStaff(person) ? tickets.filter((ticket) => ticket.topic !== 'arena').map(alertFor).reverse() : null,
    arenaAlerts: isStaff(person) || person.kind === 'arena' ? tickets.filter((ticket) => ticket.topic === 'arena').map(alertFor).reverse() : null,
    receipts: isStaff(person) ? [...receipts].reverse() : null
  };
}

function find(id) {
  const ticket = tickets.find((entry) => entry.id === id);
  if (!ticket) throw new Error('That ticket no longer exists.');
  return ticket;
}

const actions = {
  settings(person, body) {
    if (typeof body.staffOnly === 'boolean') settings.staffOnly = body.staffOnly;
    if (typeof body.faceitStatus === 'string') settings.faceitStatus = body.faceitStatus;
    if (typeof body.rosterNext === 'string') settings.rosterNext = body.rosterNext;
  },
  // "Contact Support": refused for non-staff while the system is staff-only.
  start(person) {
    if (settings.staffOnly && person.kind === 'player') {
      throw new Error('The new ticket system is being tested by staff right now. For now, please use the usual ticket channel.');
    }
    return { picker: true };
  },
  open(person, body) {
    if (settings.staffOnly && person.kind === 'player') throw new Error('The new ticket system is being tested by staff right now. For now, please use the usual ticket channel.');
    const ticket = openTicket(person, body.form, body.values || {});
    return { opened: ticket.id, notice: `Your ticket is open: #${ticket.channelName}` };
  },
  message(person, body) {
    const ticket = find(body.id);
    if (!canSee(person, ticket)) throw new Error("You can't see that channel.");
    const content = String(body.content || '').trim();
    if (content) say(ticket, person.name, content.slice(0, 2000));
  },
  claim(person, body) {
    const ticket = find(body.id);
    if (!canHandle(person, ticket)) throw new Error('Only staff can claim tickets.');
    if (ticket.status !== 'open') throw new Error('This ticket is already closed.');
    ticket.claimedBy = person.id;
    ticket.claimedTag = person.name;
  },
  reassign(person, body) {
    const ticket = find(body.id);
    if (!canHandle(person, ticket)) throw new Error('Only staff can reassign tickets.');
    const target = PEOPLE[body.to];
    if (!target || target.kind === 'player') throw new Error('Pick a staff member.');
    ticket.claimedBy = body.to;
    ticket.claimedTag = target.name;
  },
  priority(person, body) {
    const ticket = find(body.id);
    if (!canHandle(person, ticket)) throw new Error('Only staff can change the priority.');
    if (!PRIORITIES[body.priority]) throw new Error('Unknown priority.');
    ticket.priority = body.priority;
    ticket.priorityOverride = true;
    ticket.priorityReason = `Set by ${person.name}`;
  },
  close(person, body) {
    const ticket = find(body.id);
    if (ticket.status !== 'open') throw new Error('This ticket is already closed.');
    if (!canHandle(person, ticket)) throw new Error('Only staff can close tickets.');
    const reason = String(body.reason || '').trim() || null;
    const now = Date.now();
    const transcript = buildTranscript(ticket, ticket.messages, { closedBy: person.name, reason, nowMs: now });
    Object.assign(ticket, { status: 'closed', closedBy: person.id, closedAt: new Date(now).toISOString(), closeReason: reason });
    receipts.push({ id: ticket.id, header: buildTicketHeader(ticket), closedBy: person.id, file: `ticket-${ticket.id}.txt`, transcript });
    return { notice: 'Transcript saved to Support Receipts. In Discord the ticket channel is deleted 5 seconds later.' };
  },
  reset() {
    tickets = [];
    receipts = [];
    nextNumber = 41;
  }
};

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (request.method === 'GET' && url.pathname === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(PAGE.replace('__BUILD__', BUILD));
    return;
  }
  if (url.pathname !== '/api') {
    response.writeHead(404).end('Not found');
    return;
  }
  let raw = '';
  for await (const chunk of request) raw += chunk;
  let body = {};
  let error = null;
  let extra = null;
  try {
    body = raw ? JSON.parse(raw) : {};
    const person = { id: body.as, ...(PEOPLE[body.as] || PEOPLE.zoro) };
    if (body.action) {
      const action = actions[body.action];
      if (!action) throw new Error('Unknown action.');
      extra = action(person, body) || null;
      version += 1;
    }
  } catch (caught) {
    error = caught.message;
  }
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ error, ...(extra || {}), ...view(PEOPLE[body.as] ? body.as : 'zoro') }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Ticket simulator: http://localhost:${PORT}  (Ctrl+C to stop)`);
});

// The page. Its script uses no template literals and no backslashes, because it sits inside one.
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ticket simulator</title>
<style>
  :root { --bg:#313338; --side:#2b2d31; --card:#2b2d31; --text:#dbdee1; --muted:#949ba4; --line:#3f4147; --blurple:#5865f2; --grey:#4e5058; --green:#248046; --red:#da373c; --input:#1e1f22; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.4 "gg sans","Segoe UI",system-ui,sans-serif; display:flex; min-height:100vh; }
  aside { width:300px; flex:none; background:var(--side); padding:16px; border-right:1px solid var(--line); overflow:auto; }
  main { flex:1; padding:18px 24px 60px; min-width:0; }
  h1 { font-size:16px; margin:0 0 4px; }
  h2 { font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin:18px 0 8px; }
  p.note { color:var(--muted); font-size:13px; margin:0 0 8px; }
  label { display:block; font-size:12px; color:var(--muted); margin:8px 0 3px; }
  input[type=text], textarea, select { width:100%; background:var(--input); color:var(--text); border:1px solid var(--line); border-radius:4px; padding:7px 8px; font:inherit; }
  textarea { min-height:70px; resize:vertical; }
  button { font:inherit; font-weight:500; color:#fff; border:0; border-radius:4px; padding:8px 14px; cursor:pointer; }
  button.primary { background:var(--blurple); } button.secondary { background:var(--grey); } button.danger { background:var(--red); } button.success { background:var(--green); }
  button.link { background:var(--grey); }
  button:hover { filter:brightness(1.1); }
  .list { display:grid; gap:6px; }
  .list button { text-align:left; background:var(--input); border:1px solid var(--line); color:var(--text); }
  .list button.on { border-color:var(--blurple); background:#3c4270; color:#fff; }
  .list button small { color:var(--muted); }
  .chan { display:block; width:100%; text-align:left; background:none; color:var(--muted); padding:5px 8px; border-radius:4px; font-weight:500; }
  .chan:hover { background:#35373c; color:var(--text); } .chan.on { background:#404249; color:#fff; }
  .chan .dot { float:right; font-size:12px; }
  .check { display:flex; align-items:center; gap:8px; margin-top:8px; font-size:14px; color:var(--text); }
  .top { color:var(--muted); font-size:13px; margin-bottom:14px; border-bottom:1px solid var(--line); padding-bottom:10px; }
  .top b { color:var(--text); font-size:15px; }
  .msg { display:flex; gap:14px; max-width:760px; margin-bottom:14px; }
  .avatar { width:40px; height:40px; border-radius:50%; background:#ff5500; flex:none; display:grid; place-items:center; font-weight:700; color:#fff; font-size:13px; }
  .avatar.user { background:#5865f2; }
  .who { font-weight:600; } .tag { background:var(--blurple); color:#fff; font-size:10px; border-radius:3px; padding:1px 5px; margin-left:6px; vertical-align:middle; }
  .body { white-space:pre-wrap; overflow-wrap:anywhere; }
  .embed { margin-top:6px; background:var(--card); border-left:4px solid var(--green); border-radius:4px; padding:12px 16px; max-width:560px; }
  .embed .title { font-weight:700; font-size:16px; margin-bottom:6px; }
  .field { margin-top:10px; } .field .name { font-weight:700; font-size:14px; } .field .value { white-space:pre-wrap; font-size:14px; overflow-wrap:anywhere; }
  .rowb { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; align-items:center; }
  .rowb select { width:auto; min-width:220px; }
  .mention { background:#3c4270; color:#c9cdfb; border-radius:3px; padding:0 2px; font-weight:500; }
  .eph { margin:0 0 14px; max-width:760px; background:#2a2f45; border-left:4px solid var(--blurple); border-radius:4px; padding:10px 12px; font-size:14px; }
  .eph.bad { background:#3a2a2c; border-left-color:#f23f43; }
  .eph small { display:block; color:var(--muted); margin-top:4px; }
  .compose { display:flex; gap:8px; max-width:760px; margin-top:18px; }
  .empty { color:var(--muted); }
  pre.file { background:var(--input); border:1px solid var(--line); border-radius:4px; padding:10px; white-space:pre-wrap; font-size:12px; max-width:760px; overflow-wrap:anywhere; }
  .overlay { position:fixed; inset:0; background:rgba(0,0,0,.7); display:grid; place-items:center; padding:16px; z-index:5; }
  .modal { background:var(--bg); border-radius:8px; width:min(480px,100%); max-height:92vh; overflow:auto; padding:18px; }
  .modal h3 { margin:0 0 6px; font-size:19px; }
  .modal .req { color:#f23f43; }
  .modal .foot { display:flex; justify-content:flex-end; gap:8px; margin-top:16px; }
  @media (max-width: 800px) { body { flex-direction:column; } aside { width:auto; border-right:0; border-bottom:1px solid var(--line); } }
</style>
</head>
<body>
<aside>
  <h1>Ticket simulator</h1>
  <p class="note">Runs the bot's real ticket rules. Nothing is posted to Discord.</p>

  <h2>You are</h2>
  <div class="list" id="people"></div>

  <h2>Channels you can see</h2>
  <div id="channels"></div>

  <h2>What the bot would find</h2>
  <label>FACEIT says the match in the link is</label>
  <select id="faceitStatus">
    <option value="">not found / no link</option>
    <option value="ONGOING">live (ongoing)</option>
    <option value="READY">about to start (ready)</option>
    <option value="FINISHED">finished</option>
  </select>
  <label>Roster ticket: the team's next match is</label>
  <select id="rosterNext">
    <option value="soon">within 24 hours</option>
    <option value="later">more than 24 hours away</option>
    <option value="none">not scheduled</option>
    <option value="unknown">unreadable (schedule lookup failed)</option>
  </select>
  <label class="check"><input type="checkbox" id="staffOnly"> Staff-only test mode (TICKETS_STAFF_ONLY)</label>

  <h2>Start over</h2>
  <button class="secondary" id="reset">Clear all tickets</button>
</aside>
<main>
  <div class="top" id="top"></div>
  <div id="eph"></div>
  <div id="view"></div>
</main>
<div id="overlay"></div>
<script>
var $ = function (id) { return document.getElementById(id); };
var me = 'zoro';
var channel = 'panel';
var state = null;
var notice = null;

function esc(text) { var d = document.createElement('div'); d.textContent = text == null ? '' : String(text); return d.innerHTML; }
function swap(html, from, to) { return html.split(from).join(to); }
// Discord formatting: **bold**, mentions and <t:...:R> times.
function md(text) {
  var html = esc(text).replace(new RegExp('[*][*](.+?)[*][*]', 'g'), '<b>$1</b>');
  if (state) {
    state.people.forEach(function (p) { html = swap(html, '&lt;@' + p.id + '&gt;', '<span class="mention">@' + esc(p.name) + '</span>'); });
    Object.keys(state.roles).forEach(function (id) { html = swap(html, '&lt;@&amp;' + id + '&gt;', '<span class="mention">@' + esc(state.roles[id]) + '</span>'); });
    Object.keys(state.channelNames).forEach(function (id) { html = swap(html, '&lt;#' + id + '&gt;', '<span class="mention">#' + esc(state.channelNames[id]) + '</span>'); });
  }
  return html.replace(new RegExp('&lt;t:([0-9]+):[A-Za-z]&gt;', 'g'), function (all, seconds) {
    return '<span class="mention">' + esc(new Date(Number(seconds) * 1000).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })) + '</span>';
  });
}

function api(body) {
  body = body || {};
  body.as = me;
  return fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function (response) { return response.json(); })
    .then(function (data) {
      if (data.build !== '__BUILD__') { location.reload(); return null; }
      state = data;
      notice = data.error ? { bad: true, text: data.error } : data.notice ? { bad: false, text: data.notice } : null;
      if (data.opened) channel = data.opened;
      render();
      return data;
    });
}

function button(label, style, onclick) {
  var b = document.createElement('button');
  b.className = style;
  b.textContent = label;
  b.onclick = onclick;
  return b;
}

function embedHtml(header) {
  var fields = header.fields.map(function (f) { return '<div class="field"><div class="name">' + esc(f.name) + '</div><div class="value">' + md(f.value) + '</div></div>'; }).join('');
  var color = '#' + ('000000' + Number(header.color).toString(16)).slice(-6);
  return '<div class="embed" style="border-left-color:' + color + '"><div class="title">' + esc(header.title) + '</div><div>' + md(header.description) + '</div>' + fields + '</div>';
}

function botMessage(inner) {
  return '<div class="msg"><div class="avatar">CF</div><div style="min-width:0;flex:1"><span class="who">CROSSFIRE Bot</span><span class="tag">APP</span>' + inner + '</div></div>';
}

function renderSide() {
  $('people').innerHTML = '';
  state.people.forEach(function (p) {
    var b = button('', p.id === me ? 'on' : '', function () { me = p.id; channel = 'panel'; notice = null; api(); });
    b.innerHTML = esc(p.name) + ' <small>· ' + esc(p.note) + '</small>';
    $('people').appendChild(b);
  });
  var list = [['panel', '# open-a-ticket', '']];
  state.tickets.forEach(function (t) { list.push([t.id, '# ' + t.channelName, state.priorities[t.priority].emoji]); });
  if (state.alerts) list.push(['alerts', '# ticket-alerts', state.alerts.filter(function (a) { return a.open && !a.claimed; }).length || '']);
  if (state.arenaAlerts) list.push(['arenaAlerts', '# arena-tickets', state.arenaAlerts.filter(function (a) { return a.open && !a.claimed; }).length || '']);
  if (state.receipts) list.push(['receipts', '# support-receipts', state.receipts.length || '']);
  if (!list.some(function (entry) { return entry[0] === channel; })) channel = 'panel';
  $('channels').innerHTML = '';
  list.forEach(function (entry) {
    var b = button('', 'chan' + (entry[0] === channel ? ' on' : ''), function () { channel = entry[0]; notice = null; render(); });
    b.innerHTML = esc(entry[1]) + (entry[2] !== '' ? '<span class="dot">' + esc(entry[2]) + '</span>' : '');
    $('channels').appendChild(b);
  });
  $('faceitStatus').value = state.settings.faceitStatus;
  $('rosterNext').value = state.settings.rosterNext;
  $('staffOnly').checked = state.settings.staffOnly;
}

function renderPanel() {
  $('top').innerHTML = '<b># open-a-ticket</b> · everyone can see this channel';
  $('view').innerHTML = botMessage('<div class="embed"><div class="title">⚔️ CROSSFIRE SUPPORT ⚔️</div><div class="body">Need assistance? Our Crossfire Support Team is here to help you!\\n\\n🛠️ This is the official route for CROSSFIRE support.\\n⬇️ Use the button below to open a support ticket.\\n\\nPlease use tickets to contact staff members.</div></div><div class="rowb" id="panelRow"></div>');
  $('panelRow').appendChild(button('📩 Contact Support', 'danger', function () {
    api({ action: 'start' }).then(function (data) { if (data && data.picker) topicPicker(); });
  }));
}

function topicPicker() {
  notice = null;
  var box = '<div class="eph">What do you need help with? Pick a subject, answer a few questions, and a private ticket opens with the staff.<div class="rowb" id="topicRow"></div><small>Only you can see this</small></div>';
  $('eph').innerHTML = box;
  // League and Arena ask what it is about (a second dropdown in Discord); the others open a form.
  var second = function (title, kinds, formFor) {
    $('eph').innerHTML = '<div class="eph">' + title + ' What is it about?<div class="rowb" id="kindRow"></div><small>Only you can see this</small></div>';
    kinds.forEach(function (kind) {
      var k = button(kind.emoji + ' ' + kind.label, 'secondary', function () { showForm(formFor(kind)); });
      k.title = kind.description;
      $('kindRow').appendChild(k);
    });
  };
  state.subjects.forEach(function (subject) {
    var b = button(subject.emoji + ' ' + subject.label, 'secondary', function () {
      if (subject.key === 'league') second('🏆 <b>League.</b>', state.leagueKinds, function (kind) { return kind.value; });
      else if (subject.key === 'arena') second('🎮 <b>Arena.</b>', state.arenaKinds, function (kind) { return 'arena:' + kind.value; });
      else showForm(subject.key);
    });
    b.title = subject.description;
    $('topicRow').appendChild(b);
  });
}

function showForm(key) {
  var form = state.forms[key];
  var html = '<div class="overlay"><div class="modal"><h3>' + esc(form.title) + '</h3>';
  form.fields.forEach(function (f) {
    html += '<label>' + esc(f.label) + (f.required ? ' <span class="req">*</span>' : '') + '</label>';
    if (f.type === 'select') html += '<select data-id="' + esc(f.id) + '"><option value="">Make a selection</option>' + f.options.map(function (o) { return '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>'; }).join('') + '</select>';
    else if (f.type === 'para') html += '<textarea data-id="' + esc(f.id) + '" placeholder="' + esc(f.placeholder || '') + '"></textarea>';
    else html += '<input type="text" data-id="' + esc(f.id) + '" placeholder="' + esc(f.placeholder || '') + '">';
  });
  html += '<div class="foot" id="formFoot"></div></div></div>';
  $('overlay').innerHTML = html;
  $('formFoot').appendChild(button('Cancel', 'secondary', function () { $('overlay').innerHTML = ''; }));
  $('formFoot').appendChild(button('Submit', 'primary', function () {
    var values = {};
    document.querySelectorAll('#overlay [data-id]').forEach(function (el) { values[el.dataset.id] = el.value; });
    api({ action: 'open', form: key, values: values }).then(function (data) {
      if (data && !data.error) { $('overlay').innerHTML = ''; }
      else if (data) { alert(data.error); }
    });
  }));
}

function renderTicket(ticket) {
  $('top').innerHTML = '<b># ' + esc(ticket.channelName) + '</b> · ' + esc(ticket.topicLine) + ' · visible to the opener and staff only';
  var html = '';
  ticket.messages.forEach(function (m, index) {
    if (index === 0) html += botMessage('<div class="body">' + md(m.content) + '</div>' + embedHtml(ticket.header) + '<div class="rowb" id="controls"></div><div class="rowb" id="controls2"></div>');
    else html += '<div class="msg"><div class="avatar user">' + esc(m.author.slice(0, 2).toUpperCase()) + '</div><div style="min-width:0;flex:1"><span class="who">' + esc(m.author) + '</span><div class="body">' + md(m.content) + '</div></div></div>';
  });
  html += '<div class="compose"><input type="text" id="say" placeholder="Message #' + esc(ticket.channelName) + ' as ' + esc(state.me.name) + '"><span id="sayRow"></span></div>';
  $('view').innerHTML = html;
  // Everyone in the channel sees the staff controls; the bot refuses non-staff when they click.
  $('controls').appendChild(button(ticket.claimed ? 'Take over' : 'Claim', 'primary', function () { api({ action: 'claim', id: ticket.id }); }));
  $('controls').appendChild(button('Reassign', 'secondary', function () {
    var names = state.staff.map(function (s) { return s.name; }).join(', ');
    var picked = prompt('Reassign to which staff member? (' + names + ')', state.staff[0].name);
    if (picked === null) return;
    var target = state.staff.filter(function (s) { return s.name.toLowerCase() === picked.trim().toLowerCase(); })[0];
    api({ action: 'reassign', id: ticket.id, to: target ? target.id : '' });
  }));
  $('controls').appendChild(button('Close', 'danger', function () {
    var reason = prompt('Close this ticket. Reason (optional):', '');
    if (reason === null) return;
    api({ action: 'close', id: ticket.id, reason: reason });
  }));
  var select = document.createElement('select');
  select.innerHTML = '<option value="">Staff: change priority…</option>' + Object.keys(state.priorities).map(function (key) { return '<option value="' + key + '">' + esc(state.priorities[key].emoji + ' ' + state.priorities[key].label) + '</option>'; }).join('');
  select.onchange = function () { if (select.value) api({ action: 'priority', id: ticket.id, priority: select.value }); };
  $('controls2').appendChild(select);
  var send = function () { var value = $('say').value; if (value.trim()) api({ action: 'message', id: ticket.id, content: value }); };
  $('sayRow').appendChild(button('Send', 'primary', send));
  $('say').onkeydown = function (event) { if (event.key === 'Enter') send(); };
}

function renderAlerts(alerts, name, who) {
  $('top').innerHTML = '<b># ' + name + '</b> · ' + who;
  if (!alerts.length) { $('view').innerHTML = '<p class="empty">No tickets yet. Open one as a player from # open-a-ticket.</p>'; return; }
  $('view').innerHTML = '';
  alerts.forEach(function (alert) {
    var wrap = document.createElement('div');
    wrap.innerHTML = botMessage('<div class="body">' + md(alert.text) + '</div><div class="rowb"></div>');
    var row = wrap.querySelector('.rowb');
    if (alert.open) {
      row.appendChild(button(alert.claimed ? 'Take over' : 'Claim', alert.claimed ? 'secondary' : 'primary', function () { api({ action: 'claim', id: alert.id }); }));
      row.appendChild(button('Open ticket ↗', 'link', function () { channel = alert.id; notice = null; render(); }));
    }
    $('view').appendChild(wrap);
  });
}

function renderReceipts() {
  $('top').innerHTML = '<b># support-receipts</b> · staff only · one post per closed ticket, with the transcript file';
  if (!state.receipts.length) { $('view').innerHTML = '<p class="empty">No closed tickets yet.</p>'; return; }
  $('view').innerHTML = state.receipts.map(function (r) {
    var header = { title: r.header.title, description: 'Closed by <@' + r.closedBy + '>.', fields: r.header.fields, color: 0x95a5a6 };
    return botMessage(embedHtml(header) + '<p class="note" style="margin-top:8px">📎 ' + esc(r.file) + '</p><pre class="file">' + esc(r.transcript) + '</pre>');
  }).join('');
}

function render() {
  if (!state) return;
  renderSide();
  $('eph').innerHTML = notice ? '<div class="eph' + (notice.bad ? ' bad' : '') + '">' + esc(notice.text) + '<small>Only you can see this</small></div>' : '';
  var ticket = state.tickets.filter(function (t) { return t.id === channel; })[0];
  if (ticket) renderTicket(ticket);
  else if (channel === 'alerts' && state.alerts) renderAlerts(state.alerts, 'ticket-alerts', 'staff only · where Tournament Operations is pinged');
  else if (channel === 'arenaAlerts' && state.arenaAlerts) renderAlerts(state.arenaAlerts, 'arena-tickets', 'Arena staff · in the internal server');
  else if (channel === 'receipts' && state.receipts) renderReceipts();
  else renderPanel();
}

$('faceitStatus').onchange = function () { api({ action: 'settings', faceitStatus: $('faceitStatus').value }); };
$('rosterNext').onchange = function () { api({ action: 'settings', rosterNext: $('rosterNext').value }); };
$('staffOnly').onchange = function () { api({ action: 'settings', staffOnly: $('staffOnly').checked }); };
$('reset').onclick = function () { if (confirm('Clear all tickets and receipts?')) { channel = 'panel'; api({ action: 'reset' }); } };
api();
// Other people's changes show up by themselves, like in Discord.
setInterval(function () {
  if ($('overlay').innerHTML || document.activeElement === $('say') && $('say').value) return;
  fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ as: me }) })
    .then(function (response) { return response.json(); })
    .then(function (data) { if (state && data.version !== state.version) { state = data; render(); } });
}, 2000);
</script>
</body>
</html>`;
