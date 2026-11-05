import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMyCastsView,
  buildPostCastNudge,
  buildPreCastReminder,
  buildStatsCard,
  computeCasterStats,
  formatStatsLine,
  isPostCastNudgeDue,
  isPreCastReminderDue
} from '../src/streamRequest.js';

const me = '111';
const START = '2026-11-06T01:00:00.000Z';
const startMs = Date.parse(START);
const minutes = (count) => count * 60 * 1000;
const hours = (count) => count * 60 * 60 * 1000;

const approved = {
  id: 'stream-a',
  requesterId: me,
  status: 'approved',
  matchup: 'Alpha vs Bravo',
  faceitUrl: 'https://www.faceit.com/en/cs2/room/1-abc',
  faceitScheduledAtIso: START,
  reviewedAt: '2026-11-04T12:00:00.000Z'
};

// ---------- 30-minute reminder ----------

test('the pre-cast reminder is due from 30 minutes before start until start', () => {
  assert.equal(isPreCastReminderDue(approved, startMs - minutes(31)), false);
  assert.equal(isPreCastReminderDue(approved, startMs - minutes(30)), true);
  assert.equal(isPreCastReminderDue(approved, startMs - minutes(5)), true, 'still sent after a restart that missed the exact minute');
  assert.equal(isPreCastReminderDue(approved, startMs), false);
});

test('the pre-cast reminder goes once per scheduled time and again after a reschedule', () => {
  const reminded = { ...approved, preCastReminderFor: START };
  assert.equal(isPreCastReminderDue(reminded, startMs - minutes(10)), false);
  const moved = { ...reminded, faceitScheduledAtIso: '2026-11-06T02:00:00.000Z' };
  assert.equal(isPreCastReminderDue(moved, Date.parse('2026-11-06T01:45:00.000Z')), true);
});

test('no pre-cast reminder for unscheduled, finished, withdrawn or just-approved casts', () => {
  const at = startMs - minutes(10);
  assert.equal(isPreCastReminderDue({ ...approved, faceitScheduledAtIso: null, dateTimeIso: null }, at), false);
  assert.equal(isPreCastReminderDue({ ...approved, terminalNotifiedAt: '2026-11-06T00:00:00Z' }, at), false);
  assert.equal(isPreCastReminderDue({ ...approved, status: 'withdrawn' }, at), false);
  assert.equal(isPreCastReminderDue({ ...approved, status: 'pending' }, at), false);
  assert.equal(isPreCastReminderDue({ ...approved, reviewedAt: new Date(startMs - minutes(20)).toISOString() }, at), false);
  assert.equal(isPreCastReminderDue({ ...approved, status: 'publish_failed' }, at), true, 'website trouble does not stop the caster reminder');
  assert.equal(isPreCastReminderDue({ ...approved, faceitScheduledAtIso: null, dateTimeIso: START }, at), true);
});

test('the pre-cast reminder names the time, room, IP status and co-casters', () => {
  const text = buildPreCastReminder(approved, { coCasters: ['spawned_in', 'other#0001'], liveBoard: true });
  assert.match(text, /^⏰ \*\*Alpha vs Bravo\*\* starts <t:\d+:R> \(<t:\d+:t>\)\./);
  assert.match(text, /Matchroom: https:\/\/www\.faceit\.com/);
  assert.match(text, /IP not sent yet/);
  assert.match(text, /Co-casting with: spawned_in, other#0001/);
  assert.match(text, /press \*\*Going live\*\*/);
  const plain = buildPreCastReminder({ ...approved, faceitUrl: null }, {});
  assert.doesNotMatch(plain, /Matchroom|Co-casting|Going live/);
});

// ---------- 48-hour form nudge ----------

const finished = {
  ...approved,
  terminalNotifiedAt: '2026-11-06T03:00:00.000Z',
  postCastReminderSentAt: '2026-11-06T03:00:00.000Z'
};
const sentMs = Date.parse(finished.postCastReminderSentAt);
const since = '2026-11-02T00:00:00Z';

test('the form nudge is due 48 hours after the form DM while the form is missing', () => {
  assert.equal(isPostCastNudgeDue(finished, sentMs + hours(47), { since }), false);
  assert.equal(isPostCastNudgeDue(finished, sentMs + hours(48), { since }), true);
  assert.equal(isPostCastNudgeDue(finished, sentMs + hours(200), { since }), true);
});

test('no nudge once the form is in, staff marked it, a nudge went out, or before the cutoff', () => {
  const later = sentMs + hours(49);
  assert.equal(isPostCastNudgeDue({ ...finished, postCastFormSubmittedAt: 'x', postCastFormSource: 'form' }, later, { since }), false);
  assert.equal(isPostCastNudgeDue({ ...finished, postCastFormWaivedAt: 'x', postCastFormSource: 'staff' }, later, { since }), false);
  assert.equal(isPostCastNudgeDue({ ...finished, postCastNudgeSentAt: 'x' }, later, { since }), false);
  assert.equal(isPostCastNudgeDue({ ...finished, status: 'withdrawn' }, later, { since }), false);
  assert.equal(isPostCastNudgeDue({ ...approved }, later, { since }), false, 'no form DM, no nudge');
  assert.equal(isPostCastNudgeDue(finished, later, { since: '2026-11-07T00:00:00Z' }), false);
});

test('a failed sheet check is retried after an hour, not every minute', () => {
  const later = sentMs + hours(49);
  const checked = { ...finished, postCastNudgeCheckedAt: new Date(later - minutes(30)).toISOString() };
  assert.equal(isPostCastNudgeDue(checked, later, { since }), false);
  assert.equal(isPostCastNudgeDue(checked, later + minutes(31), { since }), true);
});

test('the nudge DM carries the pre-filled link and the gate warning', () => {
  const text = buildPostCastNudge(finished, { formUrl: 'https://forms.example/?id=stream-a', gate: true });
  assert.match(text, /still do not have your post-cast stats form for \*\*Alpha vs Bravo\*\* \(request stream-a\)/);
  assert.match(text, /https:\/\/forms\.example\/\?id=stream-a/);
  assert.match(text, /next stream request is blocked/);
  assert.doesNotMatch(buildPostCastNudge(finished, {}), /blocked|https/);
});

// ---------- personal stats ----------

const season7 = { id: 'season-7', name: 'Season 7', startDate: '2026-11-02', endDate: null };
const NOW = Date.parse('2026-11-20T18:00:00Z');
const past = (id, iso, extra = {}) => ({
  ...approved,
  id,
  matchup: `${id} vs X`,
  faceitScheduledAtIso: iso,
  terminalNotifiedAt: iso,
  postCastReminderSentAt: iso,
  ...extra
});
const history = [
  past('in-1', '2026-11-03T01:00:00Z', { postCastFormSubmittedAt: 'x', postCastFormSource: 'form' }),
  past('in-2', '2026-11-05T01:00:00Z', { postCastFormWaivedAt: 'x', postCastFormSource: 'staff' }),
  past('missing', '2026-11-10T01:00:00Z'),
  past('no-dm', '2026-11-12T01:00:00Z', { postCastReminderSentAt: null }),
  past('season6', '2026-10-01T01:00:00Z', { postCastFormSubmittedAt: 'x', postCastFormSource: 'form' }),
  { ...approved, id: 'upcoming', faceitScheduledAtIso: '2026-11-25T01:00:00Z' },
  past('canceled', '2026-11-08T01:00:00Z', { faceitStatus: 'CANCELLED', postCastReminderSentAt: null }),
  past('someone-else', '2026-11-08T01:00:00Z', { requesterId: '222' })
];

test('season stats count finished casts in the season and only forms that were DMed', () => {
  const stats = computeCasterStats(history, { requesterId: me, season: season7, now: NOW });
  assert.equal(stats.scope, 'Season 7');
  assert.equal(stats.casts, 4);
  assert.equal(stats.formsDue, 3);
  assert.equal(stats.formsIn, 2);
  assert.equal(stats.rate, 67);
  assert.deepEqual(stats.matchups, ['no-dm vs X', 'missing vs X', 'in-2 vs X', 'in-1 vs X']);
  assert.equal(formatStatsLine(stats), '📊 **Season 7** · 4 casts · forms 67% (2/3)');
});

test('without a season the stats cover all time', () => {
  const stats = computeCasterStats(history, { requesterId: me, now: NOW });
  assert.equal(stats.scope, 'All time');
  assert.equal(stats.casts, 5);
  assert.equal(stats.rate, 75);
});

test('a caster with no forms due yet gets no percentage', () => {
  const stats = computeCasterStats([past('no-dm', '2026-11-12T01:00:00Z', { postCastReminderSentAt: null })], { requesterId: me, season: season7, now: NOW });
  assert.equal(stats.rate, null);
  assert.equal(formatStatsLine(stats), '📊 **Season 7** · 1 cast · forms no forms due yet');
});

test('the stats line sits at the top of /request mine', () => {
  const stats = computeCasterStats(history, { requesterId: me, season: season7, now: NOW });
  const view = buildMyCastsView(history, { requesterId: me, now: NOW, stats });
  assert.ok(view.description.startsWith('📊 **Season 7** · 4 casts · forms 67% (2/3)\n\n**Upcoming**'));
});

test('the shared card shows stats and matchups only', () => {
  const stats = computeCasterStats(history, { requesterId: me, season: season7, now: NOW });
  const card = buildStatsCard(stats, { userId: me });
  assert.equal(card.title, '🎙️ Casting stats · Season 7');
  assert.equal(card.description, '<@111>');
  assert.deepEqual(card.fields.map((field) => [field.name, field.value]), [
    ['Casts', '4'],
    ['Post-cast forms', '67% (2/3)'],
    ['Matches covered', '• no-dm vs X\n• missing vs X\n• in-2 vs X\n• in-1 vs X']
  ]);
  assert.doesNotMatch(JSON.stringify(card), /faceit\.com|\bIP\b|[Uu]pcoming/);
  const many = buildStatsCard({ ...stats, matchups: Array.from({ length: 13 }, (_, index) => `M${index}`) });
  assert.match(many.fields[2].value, /…and 3 more$/);
  assert.equal(buildStatsCard({ ...stats, rate: null, matchups: [] }).fields[1].value, 'None due yet');
});
