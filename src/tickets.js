// Support tickets: the #open-a-ticket panel, the questions each topic asks, priority, the ticket's
// header card and the transcript posted when it closes. Pure functions; index.js runs Discord.

export const TICKET_TOPICS = [
  { key: 'support', label: 'General Support', emoji: '🛟', description: 'Questions or help with anything else', prefix: 'support' },
  { key: 'match', label: 'Match / FACEIT Issue', emoji: '⚔️', description: 'A problem with a match, the FACEIT room or a server', prefix: 'match' },
  { key: 'roster', label: 'Roster Change', emoji: '🔁', description: 'Captains: add, remove, bench or promote players', prefix: 'roster' },
  { key: 'arena', label: 'Arena / 10mans', emoji: '🎮', description: 'Crossfire Arena: report a player, live game problem, appeal, FACEIT link help', prefix: 'arena' },
  { key: 'apply', label: 'Apply to Crossfire', emoji: '📝', description: 'Apply to join the Crossfire staff or crew', prefix: 'apply' }
];

export function ticketTopic(key) {
  return TICKET_TOPICS.find((topic) => topic.key === key) || null;
}

// Arena / 10mans tickets: the opener picks one of these first, and each has its own form.
export const ARENA_TICKET_KINDS = [
  { value: 'report', label: 'Report a player', emoji: '🚩', description: 'Cheating, toxic, griefing, throwing, leaving / AFK', prefix: 'arena-report' },
  { value: 'live', label: 'Live game problem', emoji: '🔴', description: 'A game happening now: server, someone left, wrong teams, need a sub', prefix: 'arena-live' },
  { value: 'appeal', label: 'Ban / punishment appeal', emoji: '⚖️', description: 'Appeal a ban, cooldown or penalty in the Arena', prefix: 'arena-appeal' },
  { value: 'link', label: 'FACEIT link / voice help', emoji: '🔗', description: "FACEIT link problems, not getting moved to your team, can't join the hub", prefix: 'arena-link' }
];

export function arenaTicketKind(value) {
  return ARENA_TICKET_KINDS.find((kind) => kind.value === value) || null;
}

export const ARENA_REPORT_REASONS = ['Cheating', 'Toxic / harassment', 'Griefing / throwing', 'Left the game / AFK', 'Smurf / alt account', 'Other'];
export const ARENA_LIVE_PROBLEMS = ["Server down / can't connect", 'Someone left / AFK', 'Wrong teams / draft problem', 'Need a sub', 'Other'];
export const ARENA_APPEAL_TYPES = ['Ban', 'Cooldown / queue timeout', 'Elo or result penalty', 'Other'];
export const ARENA_LINK_ISSUES = ['Someone else has my FACEIT linked', "I'm not getting moved to my team's channel", 'Wrong FACEIT account linked to me', "Can't join the Arena hub", 'Other'];

// The topic as people read it: "Arena · Report a player", "General Support".
export function ticketTopicLabel(ticket) {
  const topic = ticketTopic(ticket?.topic);
  if (ticket?.topic === 'arena' && arenaTicketKind(ticket.arenaKind)) return `Arena · ${arenaTicketKind(ticket.arenaKind).label}`;
  return topic?.label || 'Support';
}

// The priority of an Arena ticket. A live game problem is urgent unless FACEIT says the game is
// already over; a cheating report is priority. Returns { priority, reason }.
export function arenaTicketPriority({ kind, reason = null, faceitStatus = null } = {}) {
  const status = String(faceitStatus || '').toUpperCase();
  if (kind === 'live') {
    if (/^(FINISHED|CANCELLED|ABORTED)$/.test(status)) return { priority: 'normal', reason: `FACEIT shows the game ${status.toLowerCase()}` };
    return { priority: 'urgent', reason: status ? `Live game (FACEIT: ${status.toLowerCase()})` : 'Live game' };
  }
  if (kind === 'report' && reason === 'Cheating') return { priority: 'priority', reason: 'Cheating report' };
  return { priority: 'normal', reason: null };
}

// "Team Zoro: zoro (@d1), b, c · Team Beta: …" with players named in the ticket marked 🚩.
// teams: [{ label, players: [{ playerId, nickname }] }]   links: { [playerId]: { discordId } }
export function arenaMatchPlayersText(teams, links = {}, flagged = []) {
  const flags = new Set(flagged.map((name) => String(name).toLowerCase()));
  return teams.map((team) => `**${team.label}:** ${team.players.map((player) => {
    const flag = flags.has(player.nickname.toLowerCase()) ? '🚩 ' : '';
    const discord = links[player.playerId]?.discordId ? ` (<@${links[player.playerId].discordId}>)` : '';
    return `${flag}${player.nickname}${discord}`;
  }).join(', ')}`).join('\n');
}

// Names someone typed ("zoro, beta guy; @x") split into a list.
export function splitNames(text) {
  return String(text || '').split(/[,;\n]+|\s+and\s+/i).map((name) => name.trim().replace(/^@/, '')).filter(Boolean).slice(0, 10);
}

export const PRIORITIES = {
  urgent: { label: 'Urgent', emoji: '🔴', color: 0xe74c3c },
  priority: { label: 'Priority', emoji: '🟠', color: 0xe67e22 },
  normal: { label: 'Normal', emoji: '🟢', color: 0x2ecc71 }
};

export function priorityText(priority) {
  const entry = PRIORITIES[priority] || PRIORITIES.normal;
  return `${entry.emoji} ${entry.label}`;
}

// The match state a "Match / FACEIT Issue" opener picks.
export const MATCH_STATES = [
  { value: 'live', label: 'Live now' },
  { value: 'soon', label: 'Starting within the hour' },
  { value: 'later', label: 'Later / not scheduled yet' },
  { value: 'done', label: 'Already finished' }
];

const LIVE_FACEIT = /^(ongoing|ready|voting|configuring|check_in|paused)$/i;

// A match issue: live or about to start (by the opener, or by FACEIT's room status) is urgent and
// pings the on-duty admins. Returns { priority, reason, pingAdmins }.
export function matchIssuePriority({ state, faceitStatus = null } = {}) {
  if (faceitStatus && LIVE_FACEIT.test(String(faceitStatus))) {
    return { priority: 'urgent', reason: `FACEIT shows the match ${String(faceitStatus).toLowerCase()}`, pingAdmins: true };
  }
  if (state === 'live') return { priority: 'urgent', reason: 'Match is live', pingAdmins: true };
  if (state === 'soon') return { priority: 'urgent', reason: 'Match starts within the hour', pingAdmins: true };
  return { priority: 'normal', reason: null, pingAdmins: false };
}

const DAY_MS = 24 * 60 * 60 * 1000;

// A roster change: the team's next FACEIT match within 24 hours makes it priority. lookup is
// { ok: false } when the schedule couldn't be read, { ok: true, startMs: null } when nothing is
// scheduled. Returns { priority, reason, needsVerify }.
export function rosterPriority(lookup, now = Date.now()) {
  if (!lookup?.ok) return { priority: 'normal', reason: "Couldn't read the team's schedule: staff to verify the next match", needsVerify: true };
  if (!Number.isFinite(lookup.startMs)) return { priority: 'normal', reason: 'No match scheduled', needsVerify: false };
  if (lookup.startMs - now <= DAY_MS) return { priority: 'priority', reason: 'Next match within 24 hours', needsVerify: false };
  return { priority: 'normal', reason: 'Next match more than 24 hours away', needsVerify: false };
}

// An open roster ticket whose next match has moved into the 24-hour window gets bumped, unless staff
// set the priority themselves.
export function shouldBumpRoster(ticket, now = Date.now()) {
  if (!ticket || ticket.status !== 'open' || ticket.topic !== 'roster' || ticket.priorityOverride) return false;
  if (ticket.priority !== 'normal') return false;
  const startMs = Date.parse(ticket.nextMatchIso || '');
  return Number.isFinite(startMs) && startMs > now - 3 * 60 * 60 * 1000 && startMs - now <= DAY_MS;
}

// "match-0042-zoro" (Discord channel names: lowercase, no spaces).
export function ticketChannelName(topicKey, number, username, prefixOverride = null) {
  const prefix = prefixOverride || ticketTopic(topicKey)?.prefix || 'ticket';
  const who = String(username || 'user').toLowerCase().replace(/[^a-z0-9_-]+/g, '').slice(0, 20) || 'user';
  return `${prefix}-${String(number).padStart(4, '0')}-${who}`;
}

export function ticketNumberText(number) {
  return `#${String(number).padStart(4, '0')}`;
}

// The alert posted for Tournament Operations when a ticket opens:
// "Hey @Tournament Operations, ticket #0042 · General Support (#support-0042-crown) has been opened and needs help! Priority: 🔴 Urgent"
export function ticketAlertText(ticket, { roleIds = [] } = {}) {
  const who = roleIds.length ? roleIds.map((id) => `<@&${id}>`).join(' ') : 'Tournament Operations';
  const name = `${ticketNumberText(ticket.number)} · ${ticketTopicLabel(ticket)}`;
  const link = ticket.channelId ? ` (<#${ticket.channelId}>)` : '';
  const lines = [`Hey ${who}, ticket **${name}**${link} has been opened and needs help! Priority: ${priorityText(ticket.priority)}`];
  const admins = [...(ticket.adminPingUserIds || []).map((id) => `<@${id}>`), ...(ticket.adminPingRoleIds || []).map((id) => `<@&${id}>`)];
  if (admins.length) lines.push(`🔴 Live or about to start: ${admins.join(' ')}`);
  else if (ticket.topic === 'arena' && ticket.priority === 'urgent') lines.push('🔴 Live game: please jump in now.');
  if (ticket.status === 'closed') lines.push(`🔒 Closed by <@${ticket.closedBy}>`);
  else if (ticket.claimedBy) lines.push(`Handled by <@${ticket.claimedBy}>`);
  return lines.join('\n');
}

// The ticket's header card: { title, description, fields, color }.
export function buildTicketHeader(ticket) {
  const fields = [
    { name: 'Opened by', value: `<@${ticket.openerId}>`, inline: true },
    { name: 'Handled by', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Not claimed yet', inline: true },
    { name: 'Priority', value: `${priorityText(ticket.priority)}${ticket.priorityReason ? ` · ${ticket.priorityReason}` : ''}${ticket.priorityOverride && !/^set by /i.test(ticket.priorityReason || '') ? ' (set by staff)' : ''}`.slice(0, 1024), inline: false }
  ];
  if (ticket.needsVerify) fields.push({ name: '⚠️ Staff', value: 'Verify the next match: the bot could not read it, so the team was asked for the link and start time.' });
  for (const answer of ticket.answers || []) {
    if (String(answer.value || '').trim()) fields.push({ name: answer.label.slice(0, 256), value: String(answer.value).slice(0, 1024) });
  }
  if (ticket.status === 'closed') {
    fields.push({ name: 'Closed', value: `<@${ticket.closedBy}> · <t:${Math.floor(Date.parse(ticket.closedAt) / 1000)}:f>${ticket.closeReason ? `\n${ticket.closeReason}` : ''}`.slice(0, 1024) });
  }
  return {
    title: `🎫 Ticket ${ticketNumberText(ticket.number)} · ${ticketTopicLabel(ticket)}`.slice(0, 256),
    description: ticket.status === 'closed'
      ? 'This ticket is closed.'
      : 'The Admin team has been notified and will assist you as soon as possible. Please provide any details or evidence to help us handle this ticket.',
    fields: fields.slice(0, 25),
    color: (PRIORITIES[ticket.priority] || PRIORITIES.normal).color
  };
}

// The transcript file posted to the receipts channel: one line per message, oldest first.
// messages: [{ createdAt (ms), author, content, attachments: [url], embeds: [title] }]
export function buildTranscript(ticket, messages, { closedBy = null, reason = null, nowMs = Date.now() } = {}) {
  const stamp = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const topic = ticketTopicLabel(ticket);
  const lines = [
    `Ticket ${ticketNumberText(ticket.number)} · ${topic}`,
    `Opened by ${ticket.openerTag || ticket.openerId} on ${stamp(Date.parse(ticket.createdAt) || nowMs)}`,
    `Handled by ${ticket.claimedTag || ticket.claimedBy || 'nobody'} · Priority ${(PRIORITIES[ticket.priority] || PRIORITIES.normal).label}`,
    `Closed by ${closedBy || 'unknown'} on ${stamp(nowMs)}${reason ? ` · ${reason}` : ''}`,
    ''.padEnd(60, '-')
  ];
  for (const message of [...messages].sort((a, b) => a.createdAt - b.createdAt)) {
    const parts = [message.content || ''];
    for (const title of message.embeds || []) if (title) parts.push(`[embed: ${title}]`);
    for (const url of message.attachments || []) parts.push(`[file: ${url}]`);
    const text = parts.filter(Boolean).join(' ').trim();
    if (text) lines.push(`[${stamp(message.createdAt)}] ${message.author}: ${text}`);
  }
  return lines.join('\n');
}
