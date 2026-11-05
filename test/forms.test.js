import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFormsOverview,
  buildStaffFormNudge,
  formsNudgeCasters,
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

test('the overview is a count and one short line per cast, missing first', () => {
  const text = buildFormsOverview(selectFormCasts(requests, { since }));
  assert.equal(text, [
    '✅ **2** submitted · ❌ **4** missing',
    '',
    '**Missing**',
    '❌ b2 vs X · <@2>',
    '❌ a1 vs X · <@1>',
    '❌ b1 vs X · <@2>',
    '❌ c1 vs X · <@3>',
    '',
    '**Submitted**',
    '✅ done vs X · <@1>',
    '✅ waived vs X · <@4>',
    '',
    'Press a caster’s button to DM them their missing form links.'
  ].join('\n'));
});

test('the overview caps long lists, flags a failed sheet check and handles nothing sent yet', () => {
  const many = Array.from({ length: 30 }, (_, index) => cast(`m${index}`, '1', '2026-11-03T03:00:00Z'));
  const text = buildFormsOverview(selectFormCasts(many, { since }), { maxLines: 10, sheetCheckFailed: true });
  assert.match(text, /…and 20 more/);
  assert.doesNotMatch(text, /\*\*Submitted\*\*/);
  assert.match(text, /could not be checked just now/);
  assert.equal(buildFormsOverview({ missing: [], submitted: [] }), 'No casts have been sent the post-cast form yet.');
  assert.doesNotMatch(buildFormsOverview(selectFormCasts([requests[4]], { since })), /Missing|button/);
});

test('one Nudge button per caster with a missing form, most missing first', () => {
  assert.deepEqual(formsNudgeCasters(requests, { since }), [
    { id: '2', tag: 'caster2', count: 2 },
    { id: '3', tag: 'caster3', count: 1 },
    { id: '1', tag: 'caster1', count: 1 }
  ]);
  assert.equal(formsNudgeCasters(requests, { since, max: 2 }).length, 2);
  assert.deepEqual(groupMissingForms(requests, { since })[0].requests.map((request) => request.id), ['b1', 'b2']);
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
