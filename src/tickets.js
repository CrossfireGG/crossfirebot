// Support tickets: the #open-a-ticket panel, the questions each topic asks, priority, the ticket's
// header card and the transcript posted when it closes. Pure functions; index.js runs Discord.

export const TICKET_TOPICS = [
  { key: 'support', label: 'General Support', emoji: '🛟', description: 'Questions or help with anything else', prefix: 'support' },
  { key: 'match', label: 'Match / FACEIT Issue', emoji: '⚔️', description: 'A problem with a match, the FACEIT room or a server', prefix: 'match' },
  { key: 'roster', label: 'Roster Change', emoji: '🔁', description: 'Captains: add, remove, bench or promote players', prefix: 'roster' },
  { key: 'apply', label: 'Apply to Crossfire', emoji: '📝', description: 'Apply to join the Crossfire staff or crew', prefix: 'apply' }
];

export function ticketTopic(key) {
  return TICKET_TOPICS.find((topic) => topic.key === key) || null;
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
export function ticketChannelName(topicKey, number, username) {
  const prefix = ticketTopic(topicKey)?.prefix || 'ticket';
  const who = String(username || 'user').toLowerCase().replace(/[^a-z0-9_-]+/g, '').slice(0, 20) || 'user';
  return `${prefix}-${String(number).padStart(4, '0')}-${who}`;
}

export function ticketNumberText(number) {
  return `#${String(number).padStart(4, '0')}`;
}

// The ticket's header card: { title, description, fields, color }.
export function buildTicketHeader(ticket) {
  const topic = ticketTopic(ticket.topic);
  const fields = [
    { name: 'Opened by', value: `<@${ticket.openerId}>`, inline: true },
    { name: 'Handled by', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Not claimed yet', inline: true },
    { name: 'Priority', value: `${priorityText(ticket.priority)}${ticket.priorityReason ? ` · ${ticket.priorityReason}` : ''}${ticket.priorityOverride ? ' (set by staff)' : ''}`.slice(0, 1024), inline: false }
  ];
  if (ticket.needsVerify) fields.push({ name: '⚠️ Staff', value: 'Verify the next match: the bot could not read it, so the team was asked for the link and start time.' });
  for (const answer of ticket.answers || []) {
    if (String(answer.value || '').trim()) fields.push({ name: answer.label.slice(0, 256), value: String(answer.value).slice(0, 1024) });
  }
  if (ticket.status === 'closed') {
    fields.push({ name: 'Closed', value: `<@${ticket.closedBy}> · <t:${Math.floor(Date.parse(ticket.closedAt) / 1000)}:f>${ticket.closeReason ? `\n${ticket.closeReason}` : ''}`.slice(0, 1024) });
  }
  return {
    title: `🎫 Ticket ${ticketNumberText(ticket.number)} · ${topic?.label || 'Support'}`.slice(0, 256),
    description: ticket.status === 'closed'
      ? 'This ticket is closed.'
      : 'Staff will be with you soon. Add anything else (screenshots, links) right here in this channel.',
    fields: fields.slice(0, 25),
    color: (PRIORITIES[ticket.priority] || PRIORITIES.normal).color
  };
}

// The transcript file posted to the receipts channel: one line per message, oldest first.
// messages: [{ createdAt (ms), author, content, attachments: [url], embeds: [title] }]
export function buildTranscript(ticket, messages, { closedBy = null, reason = null, nowMs = Date.now() } = {}) {
  const stamp = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const topic = ticketTopic(ticket.topic)?.label || ticket.topic;
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
