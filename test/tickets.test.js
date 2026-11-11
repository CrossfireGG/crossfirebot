import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTicketHeader,
  buildTranscript,
  matchIssuePriority,
  rosterPriority,
  shouldBumpRoster,
  ticketChannelName,
  TICKET_TOPICS
} from '../src/tickets.js';

const NOW = Date.UTC(2026, 10, 11, 20);
const HOUR = 60 * 60 * 1000;

test('the panel has the four topics', () => {
  assert.deepEqual(TICKET_TOPICS.map((topic) => topic.label), ['General Support', 'Match / FACEIT Issue', 'Roster Change', 'Apply to Crossfire']);
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
  assert.deepEqual(header.fields.map((field) => field.name), ['Opened by', 'Handled by', 'Priority', 'Team', "What's happening"]);
  assert.equal(header.fields[1].value, 'Not claimed yet');
  assert.equal(header.fields[2].value, '🔴 Urgent · Match is live');
  const claimed = buildTicketHeader({ number: 1, topic: 'roster', openerId: '1', claimedBy: '9', priority: 'normal', priorityOverride: true, needsVerify: true });
  assert.equal(claimed.fields[1].value, '<@9>');
  assert.match(claimed.fields[2].value, /\(set by staff\)/);
  assert.equal(claimed.fields[3].name, '⚠️ Staff');
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
