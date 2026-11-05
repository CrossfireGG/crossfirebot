import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMyCastsView, connectionStatusLine, postCastFormState, splitMyCasts } from '../src/streamRequest.js';

const NOW = Date.parse('2026-11-05T18:00:00Z');
const me = '111';

function cast(overrides) {
  return {
    id: 'stream-x',
    requesterId: me,
    status: 'approved',
    matchup: 'Alpha vs Bravo',
    faceitUrl: 'https://www.faceit.com/en/cs2/room/1-abc',
    ...overrides
  };
}

const requests = [
  cast({ id: 'up-late', matchup: 'Late vs Game', faceitScheduledAtIso: '2026-11-07T01:00:00Z' }),
  cast({ id: 'up-soon', matchup: 'Soon vs Game', faceitScheduledAtIso: '2026-11-06T01:00:00Z', deliverySentAt: '2026-11-05T17:00:00Z', deliveryType: 'cstv', deliveryStatus: 'delivered' }),
  cast({ id: 'up-unscheduled', matchup: 'TBD vs Game', faceitScheduledAtIso: null, dateTimeIso: null }),
  cast({ id: 'past-missing', matchup: 'Missing vs Form', faceitScheduledAtIso: '2026-11-03T01:00:00Z', terminalNotifiedAt: '2026-11-03T03:00:00Z', postCastReminderSentAt: '2026-11-03T03:00:00Z' }),
  cast({ id: 'past-done', matchup: 'Done vs Form', faceitScheduledAtIso: '2026-11-02T01:00:00Z', terminalNotifiedAt: '2026-11-02T03:00:00Z', postCastReminderSentAt: '2026-11-02T03:00:00Z', postCastFormSubmittedAt: '2026-11-02T05:00:00Z', postCastFormSource: 'form' }),
  cast({ id: 'past-old', matchup: 'Old vs Cast', status: 'publish_failed', faceitScheduledAtIso: '2026-10-01T01:00:00Z' }),
  cast({ id: 'canceled', matchup: 'Canceled vs Match', faceitScheduledAtIso: '2026-11-04T01:00:00Z', terminalNotifiedAt: '2026-11-04T00:00:00Z', faceitStatus: 'CANCELLED' }),
  cast({ id: 'withdrawn', status: 'withdrawn', faceitScheduledAtIso: '2026-11-06T01:00:00Z' }),
  cast({ id: 'pending', status: 'pending', faceitScheduledAtIso: '2026-11-06T01:00:00Z' }),
  cast({ id: 'someone-else', requesterId: '222', faceitScheduledAtIso: '2026-11-06T01:00:00Z' })
];

test('splitMyCasts keeps only this caster\'s approved casts and orders them', () => {
  const { upcoming, past } = splitMyCasts(requests, { requesterId: me, now: NOW });
  assert.deepEqual(upcoming.map((request) => request.id), ['up-soon', 'up-late', 'up-unscheduled']);
  assert.deepEqual(past.map((request) => request.id), ['past-missing', 'past-done', 'past-old']);
});

test('a cast whose match time passed hours ago is past even without a FACEIT result', () => {
  const stale = cast({ id: 'stale', faceitScheduledAtIso: '2026-11-05T09:00:00Z' });
  const recent = cast({ id: 'recent', faceitScheduledAtIso: '2026-11-05T16:00:00Z' });
  const { upcoming, past } = splitMyCasts([stale, recent], { requesterId: me, now: NOW });
  assert.deepEqual(upcoming.map((request) => request.id), ['recent']);
  assert.deepEqual(past.map((request) => request.id), ['stale']);
});

test('postCastFormState tells received, staff-waived, missing and not-needed apart', () => {
  assert.equal(postCastFormState({ postCastReminderSentAt: 'x', postCastFormSubmittedAt: 'y', postCastFormSource: 'form' }), 'received');
  assert.equal(postCastFormState({ postCastReminderSentAt: 'x', postCastFormSubmittedAt: 'y', postCastFormWaivedAt: 'y', postCastFormSource: 'staff' }), 'waived');
  assert.equal(postCastFormState({ postCastReminderSentAt: 'x' }), 'missing');
  assert.equal(postCastFormState({}), 'not_required');
});

test('connectionStatusLine covers not sent, delivered and closed DMs', () => {
  assert.match(connectionStatusLine({}), /^⏳ IP not sent yet/);
  assert.match(connectionStatusLine({ deliverySentAt: '2026-11-05T17:00:00Z', deliveryType: 'cstv', deliveryStatus: 'delivered' }), /^✅ CSTV connect sent to your DMs <t:\d+:R>$/);
  assert.match(connectionStatusLine({ deliverySentAt: '2026-11-05T17:00:00Z', deliveryType: 'custom', deliveryStatus: 'failed' }), /^⚠️ Server IP was sent, but your DMs were closed/);
  assert.match(connectionStatusLine({ deliverySentAt: '2026-11-05T17:00:00Z', deliveryType: 'twitch', deliveryStatus: 'delivered' }), /^✅ Official stream link sent/);
});

test('the view lists upcoming and past casts with a form link only for the missing one', () => {
  const view = buildMyCastsView(requests, { requesterId: me, now: NOW, formLink: (id) => `https://forms.example/?id=${id}` });
  assert.equal(view.upcomingCount, 3);
  assert.equal(view.pastCount, 3);
  assert.deepEqual(view.missingForms, [{ id: 'past-missing', matchup: 'Missing vs Form', url: 'https://forms.example/?id=past-missing' }]);
  const text = view.description;
  assert.ok(text.indexOf('**Soon vs Game**') < text.indexOf('**Late vs Game**'));
  assert.match(text, /\[Matchroom\]\(https:\/\/www\.faceit\.com\/en\/cs2\/room\/1-abc\)/);
  assert.match(text, /\*\*TBD vs Game\*\*\nNot scheduled on FACEIT yet/);
  assert.match(text, /❌ \*\*Missing vs Form\*\* · <t:\d+:D> · form missing\n/);
  assert.match(text, /✅ \*\*Done vs Form\*\* · <t:\d+:D> · form received/);
  assert.match(text, /▫️ \*\*Old vs Cast\*\* · <t:\d+:D> · no form needed/);
  assert.doesNotMatch(text, /Canceled vs Match|someone-else/);
  assert.match(text, /Use the buttons below/);
  assert.doesNotMatch(text, /could not reach the form sheet/);
});

test('the view says so when the form sheet could not be checked or has no link', () => {
  const view = buildMyCastsView(requests, { requesterId: me, now: NOW, formCheckFailed: true });
  assert.deepEqual(view.missingForms, []);
  assert.match(view.description, /form missing \(ask staff for the form link\)/);
  assert.match(view.description, /could not reach the form sheet/);
  assert.doesNotMatch(view.description, /Use the buttons below/);
});

test('the view caps long lists and handles a caster with no casts', () => {
  const many = Array.from({ length: 13 }, (_, index) => cast({
    id: `p${index}`,
    matchup: `Team ${index} vs Other`,
    faceitScheduledAtIso: new Date(NOW - (index + 1) * 86_400_000).toISOString(),
    postCastReminderSentAt: new Date(NOW - (index + 1) * 86_400_000).toISOString()
  }));
  const view = buildMyCastsView(many, { requesterId: me, now: NOW, formLink: (id) => `https://f/${id}` });
  assert.equal(view.missingForms.length, 10);
  assert.match(view.description, /Showing your 10 most recent of 13 past casts\./);
  assert.match(view.description, /\*\*Upcoming\*\*\nNothing scheduled/);
  const empty = buildMyCastsView([], { requesterId: me, now: NOW });
  assert.match(empty.description, /no approved casts yet/);
  assert.deepEqual(empty.missingForms, []);
});
