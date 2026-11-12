import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTicketHeader,
  buildTranscript,
  matchIssuePriority,
  rosterPriority,
  shouldBumpRoster,
  ticketAlertText,
  ticketChannelName,
  TICKET_TOPICS
} from '../src/tickets.js';

const NOW = Date.UTC(2026, 10, 11, 20);
const HOUR = 60 * 60 * 1000;

test('the panel has the five topics', () => {
  assert.deepEqual(TICKET_TOPICS.map((topic) => topic.label), ['General Support', 'Match / FACEIT Issue', 'Roster Change', 'Arena / 10mans', 'Apply to Crossfire']);
});

test('a live or about-to-start match issue is urgent and pings admins', () => {
  assert.deepEqual(matchIssuePriority({ state: 'live' }), { priority: 'urgent', reason: 'Match is live', pingAdmins: true });
  assert.equal(matchIssuePriority({ state: 'soon' }).priority, 'urgent');
  assert.deepEqual(matchIssuePriority({ state: 'later' }), { priority: 'normal', reason: null, pingAdmins: false });
  assert.equal(matchIssuePriority({ state: 'later', faceitStatus: 'ONGOING' }).priority, 'urgent', 'FACEIT says it is live');
  assert.equal(matchIssuePriority({ state: 'done', faceitStatus: 'FINISHED' }).priority, 'normal');
});

test('roster changes: next match within 24 hours is priority; unknown schedule is flagged', () => {
  assert.equal(rosterPriority({ ok: true, startMs: NOW + 5 * HOUR }, NOW).priority, 'priority');
  assert.equal(rosterPriority({ ok: true, startMs: NOW + 30 * HOUR }, NOW).priority, 'normal');
  assert.deepEqual(rosterPriority({ ok: true, startMs: null }, NOW), { priority: 'normal', reason: 'No match scheduled', needsVerify: false });
  const unknown = rosterPriority({ ok: false }, NOW);
  assert.equal(unknown.priority, 'normal');
  assert.equal(unknown.needsVerify, true);
});

test('open roster tickets are bumped when the match moves into 24 hours, unless staff set it', () => {
  const ticket = { status: 'open', topic: 'roster', priority: 'normal', nextMatchIso: new Date(NOW + 20 * HOUR).toISOString() };
  assert.equal(shouldBumpRoster(ticket, NOW), true);
  assert.equal(shouldBumpRoster({ ...ticket, nextMatchIso: new Date(NOW + 30 * HOUR).toISOString() }, NOW), false);
  assert.equal(shouldBumpRoster({ ...ticket, priorityOverride: true }, NOW), false);
  assert.equal(shouldBumpRoster({ ...ticket, priority: 'priority' }, NOW), false);
  assert.equal(shouldBumpRoster({ ...ticket, status: 'closed' }, NOW), false);
  assert.equal(shouldBumpRoster({ ...ticket, topic: 'support' }, NOW), false);
});

test('ticket channel names and the header card', () => {
  assert.equal(ticketChannelName('match', 42, 'Zoro.CS'), 'match-0042-zorocs');
  const header = buildTicketHeader({
    number: 42, topic: 'match', openerId: '1', priority: 'urgent', priorityReason: 'Match is live',
    answers: [{ label: 'Team', value: 'CLUB 333' }, { label: 'Match link', value: '' }, { label: "What's happening", value: 'Server crashed' }]
  });
  assert.equal(header.title, '🎫 Ticket #0042 · Match / FACEIT Issue');
  assert.equal(header.description, 'The Admin team has been notified and will assist you as soon as possible. Please provide any details or evidence to help us handle this ticket.');
  assert.deepEqual(header.fields.map((field) => field.name), ['Opened by', 'Handled by', 'Priority', 'Team', "What's happening"]);
  assert.equal(header.fields[1].value, 'Not claimed yet');
  assert.equal(header.fields[2].value, '🔴 Urgent · Match is live');
  const claimed = buildTicketHeader({ number: 1, topic: 'roster', openerId: '1', claimedBy: '9', priority: 'normal', priorityOverride: true, needsVerify: true });
  assert.equal(claimed.fields[1].value, '<@9>');
  assert.match(claimed.fields[2].value, /\(set by staff\)/);
  assert.equal(claimed.fields[3].name, '⚠️ Staff');
  const named = buildTicketHeader({ number: 1, topic: 'support', openerId: '1', priority: 'urgent', priorityOverride: true, priorityReason: 'Set by bigntallmatt' });
  assert.equal(named.fields[2].value, '🔴 Urgent · Set by bigntallmatt', 'no repeated "(set by staff)"');
});

test('the transcript lists every message oldest first with files and embeds', () => {
  const text = buildTranscript(
    { number: 7, topic: 'support', openerTag: 'zoro', openerId: '1', claimedTag: 'admin1', priority: 'normal', createdAt: new Date(NOW).toISOString() },
    [
      { createdAt: NOW + 2 * 60000, author: 'admin1', content: 'Fixed!', attachments: [], embeds: [] },
      { createdAt: NOW + 60000, author: 'zoro', content: 'Help', attachments: ['https://cdn/x.png'], embeds: [] },
      { createdAt: NOW, author: 'CROSSFIRE', content: '', attachments: [], embeds: ['🎫 Ticket #0007 · General Support'] }
    ],
    { closedBy: 'admin1', reason: 'Solved', nowMs: NOW + 3 * 60000 }
  );
  const lines = text.split('\n');
  assert.equal(lines[0], 'Ticket #0007 · General Support');
  assert.equal(lines[3], 'Closed by admin1 on 2026-11-11 20:03 UTC · Solved');
  assert.deepEqual(lines.slice(5), [
    '[2026-11-11 20:00 UTC] CROSSFIRE: [embed: 🎫 Ticket #0007 · General Support]',
    '[2026-11-11 20:01 UTC] zoro: Help [file: https://cdn/x.png]',
    '[2026-11-11 20:02 UTC] admin1: Fixed!'
  ]);
});

test('the Tournament Operations alert names the ticket, links it and gives the priority', () => {
  const ticket = { number: 42, topic: 'support', channelId: '555', priority: 'urgent' };
  assert.equal(ticketAlertText(ticket, { roleIds: ['1474118305169019163'] }),
    'Hey <@&1474118305169019163>, ticket **#0042 · General Support** (<#555>) has been opened and needs help! Priority: 🔴 Urgent');
  assert.equal(ticketAlertText({ ...ticket, priority: 'normal', channelId: null }),
    'Hey Tournament Operations, ticket **#0042 · General Support** has been opened and needs help! Priority: 🟢 Normal');
  assert.match(ticketAlertText({ ...ticket, claimedBy: '9' }), /\nHandled by <@9>$/, 'shows who claimed it');
  assert.equal(ticketAlertText({ ...ticket, adminPingUserIds: ['3', '4'], claimedBy: '9' }).split('\n').slice(1).join(' | '),
    '🔴 Live or about to start: <@3> <@4> | Handled by <@9>', 'urgent: the on-duty admins are in the alert, and stay there after a claim');
  assert.match(ticketAlertText({ ...ticket, adminPingRoleIds: ['77'] }), /🔴 Live or about to start: <@&77>/, 'or the admin roles');
  assert.match(ticketAlertText({ ...ticket, claimedBy: '9', status: 'closed', closedBy: '7' }), /\n🔒 Closed by <@7>$/, 'and when it closes');
});

test('arena tickets: kinds, labels, channel names and priority', async () => {
  const tickets = await import('../src/tickets.js');
  assert.ok(tickets.ticketTopic('arena'), 'Arena / 10mans is on the panel');
  assert.deepEqual(tickets.ARENA_TICKET_KINDS.map((kind) => kind.value), ['report', 'live', 'appeal', 'link']);
  assert.equal(tickets.ticketTopicLabel({ topic: 'arena', arenaKind: 'report' }), 'Arena · Report a player');
  assert.equal(tickets.ticketTopicLabel({ topic: 'support' }), 'General Support');
  assert.equal(tickets.ticketChannelName('arena', 7, 'Zoro', 'arena-report'), 'arena-report-0007-zoro');
  assert.match(tickets.buildTicketHeader({ number: 7, topic: 'arena', arenaKind: 'live', openerId: 'u', priority: 'urgent', answers: [] }).title, /Arena · Live game problem/);
  assert.match(tickets.ticketAlertText({ number: 7, topic: 'arena', arenaKind: 'live', priority: 'urgent', status: 'open' }, { roleIds: ['r1', 'r2'] }), /<@&r1> <@&r2>.*Arena · Live game problem[\s\S]*Live game/);

  assert.equal(tickets.arenaTicketPriority({ kind: 'live' }).priority, 'urgent');
  assert.equal(tickets.arenaTicketPriority({ kind: 'live', faceitStatus: 'ONGOING' }).priority, 'urgent');
  assert.equal(tickets.arenaTicketPriority({ kind: 'live', faceitStatus: 'FINISHED' }).priority, 'normal');
  assert.equal(tickets.arenaTicketPriority({ kind: 'report', reason: 'Cheating' }).priority, 'priority');
  assert.equal(tickets.arenaTicketPriority({ kind: 'report', reason: 'Toxic / harassment' }).priority, 'normal');
  assert.equal(tickets.arenaTicketPriority({ kind: 'appeal' }).priority, 'normal');
});

test('arena tickets: reported names and the players in the match', async () => {
  const { arenaMatchPlayersText, splitNames } = await import('../src/tickets.js');
  assert.deepEqual(splitNames('zoro, @beta guy; x and y'), ['zoro', 'beta guy', 'x', 'y']);
  const teams = [
    { label: 'Team Zoro', players: [{ playerId: 'p1', nickname: 'zoro' }, { playerId: 'p2', nickname: 'Cheater' }] },
    { label: 'Team Beta', players: [{ playerId: 'p3', nickname: 'beta' }] }
  ];
  assert.equal(
    arenaMatchPlayersText(teams, { p1: { discordId: 'd1' } }, ['cheater']),
    '**Team Zoro:** zoro (<@d1>), 🚩 Cheater\n**Team Beta:** beta'
  );
});
