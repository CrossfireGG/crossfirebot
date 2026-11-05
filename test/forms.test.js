import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCasterFormsView,
  buildFormsOverview,
  buildStaffFormNudge,
  formsCasterSummaries,
  groupMissingForms,
  selectFormCasts,
  staffNudgeCooldownUntil
} from '../src/streamRequest.js';

const since = '2026-11-02T00:00:00Z';

function cast(id, requesterId, sentIso, extra = {}) {
  return {
    id,
    requesterId,
    requesterTag: `caster${requesterId}`,
    status: 'approved',
    matchup: `${id} vs X`,
    postCastReminderSentAt: sentIso,
    ...extra
  };
}

const requests = [
  cast('a1', '1', '2026-11-04T03:00:00Z'),
  cast('b1', '2', '2026-11-03T03:00:00Z'),
  cast('b2', '2', '2026-11-05T03:00:00Z'),
  cast('c1', '3', '2026-11-03T01:00:00Z'),
  cast('done', '1', '2026-11-06T03:00:00Z', { postCastFormSubmittedAt: 'x', postCastFormSource: 'form' }),
  cast('waived', '4', '2026-11-03T03:00:00Z', { postCastFormWaivedAt: 'x', postCastFormSource: 'staff' }),
  cast('old', '5', '2026-10-20T03:00:00Z'),
  cast('withdrawn', '6', '2026-11-03T03:00:00Z', { status: 'withdrawn' }),
  { id: 'no-dm', requesterId: '7', status: 'approved' }
];

test('selectFormCasts splits casts that got the form into missing and submitted, newest first', () => {
  const { missing, submitted } = selectFormCasts(requests, { since });
  assert.deepEqual(missing.map((request) => request.id), ['b2', 'a1', 'b1', 'c1']);
  assert.deepEqual(submitted.map((request) => request.id), ['done', 'waived']);
  assert.ok(selectFormCasts(requests).missing.some((request) => request.id === 'old'), 'no cutoff includes older casts');
});

test('one summary per caster: owing casters first (most missing), then everyone else', () => {
  assert.deepEqual(formsCasterSummaries(requests, { since }), [
    { id: '2', tag: 'caster2', missing: 2, submitted: 0, rate: 0 },
    { id: '3', tag: 'caster3', missing: 1, submitted: 0, rate: 0 },
    { id: '1', tag: 'caster1', missing: 1, submitted: 1, rate: 50 },
    { id: '4', tag: 'caster4', missing: 0, submitted: 1, rate: 100 }
  ]);
  assert.deepEqual(groupMissingForms(requests, { since })[0].requests.map((request) => request.id), ['b1', 'b2']);
});

test('the main view is the totals and one line per caster who owes forms', () => {
  const text = buildFormsOverview(formsCasterSummaries(requests, { since }));
  assert.equal(text, [
    '✅ **2** submitted · ❌ **4** missing',
    '',
    '**Owes forms**',
    '❌ <@2> · 2 missing · 0% in',
    '❌ <@3> · 1 missing · 0% in',
    '❌ <@1> · 1 missing · 50% in',
    '',
    'Pick a caster below to see their casts, nudge them or mark a form received.'
  ].join('\n'));
});

test('the main view caps long lists, flags a failed sheet check and handles nobody owing', () => {
  const many = Array.from({ length: 30 }, (_, index) => cast(`m${index}`, String(100 + index), '2026-11-03T03:00:00Z'));
  const text = buildFormsOverview(formsCasterSummaries(many, { since }), { maxLines: 10, sheetCheckFailed: true });
  assert.match(text, /…and 20 more/);
  assert.match(text, /could not be checked just now/);
  assert.equal(buildFormsOverview([]), 'No casts have been sent the post-cast form yet.');
  assert.match(buildFormsOverview(formsCasterSummaries([requests[4]], { since })), /Everyone is caught up\./);
});

test('the caster view shows their rate, missing forms with request IDs and recent submissions', () => {
  const now = Date.parse('2026-11-08T12:00:00Z');
  const view = buildCasterFormsView(requests, { casterId: '1', since, now });
  assert.match(view.description, /^<@1> · \*\*1 of 2\*\* forms in \(50%\)/);
  assert.match(view.description, /\*\*Missing\*\*\n❌ \*\*a1 vs X\*\* · <t:\d+:D> · `a1`/);
  assert.match(view.description, /\*\*Recently submitted\*\*\n✅ \*\*done vs X\*\*/);
  assert.deepEqual(view.missing.map((request) => request.id), ['a1']);
  assert.equal(view.cooldownUntil, null);

  const waived = buildCasterFormsView(requests, { casterId: '4', since, now });
  assert.match(waived.description, /✅ Nothing missing\./);
  assert.match(waived.description, /☑️ \*\*waived vs X\*\* · <t:\d+:D> · marked by staff/);

  const nudged = buildCasterFormsView([cast('n', '9', since, { postCastStaffNudgeAt: '2026-11-08T11:30:00Z' })], { casterId: '9', since, now });
  assert.equal(nudged.cooldownUntil, Date.parse('2026-11-08T12:30:00Z'));
  assert.match(nudged.description, /Nudged by staff <t:\d+:R>\. You can nudge again <t:\d+:R>\./);

  assert.match(buildCasterFormsView(requests, { casterId: '7', since }).description, /has not been sent any post-cast forms yet/);
});

test('the staff nudge DM lists every missing form with its own link', () => {
  const owed = groupMissingForms(requests, { since })[0].requests;
  const text = buildStaffFormNudge(owed, { formLink: (id) => `https://forms.example/?id=${id}`, gate: true });
  assert.match(text, /^📝 Tournament Operations is still waiting on 2 post-cast stats forms from you:/);
  assert.match(text, /- \*\*b1 vs X\*\* \(request b1\): https:\/\/forms\.example\/\?id=b1/);
  assert.match(text, /next stream request is blocked/);
  const single = buildStaffFormNudge([owed[0]]);
  assert.match(single, /^📝 Tournament Operations is still waiting on your post-cast stats form:/);
  assert.doesNotMatch(single, /https|blocked/);
});

test('staff can nudge the same caster once an hour', () => {
  const now = Date.parse('2026-11-08T12:00:00Z');
  assert.equal(staffNudgeCooldownUntil([cast('a', '1', since)], now), null);
  assert.equal(staffNudgeCooldownUntil([cast('a', '1', since, { postCastStaffNudgeAt: '2026-11-08T11:30:00Z' })], now), Date.parse('2026-11-08T12:30:00Z'));
  assert.equal(staffNudgeCooldownUntil([cast('a', '1', since, { postCastStaffNudgeAt: '2026-11-08T10:30:00Z' })], now), null);
});
