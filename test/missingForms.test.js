import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMissingFormsReport,
  buildStaffFormNudge,
  groupMissingForms,
  staffNudgeCooldownUntil
} from '../src/streamRequest.js';

const since = '2026-11-02T00:00:00Z';

function owed(id, requesterId, sentIso, extra = {}) {
  return {
    id,
    requesterId,
    requesterTag: `caster${requesterId}`,
    status: 'approved',
    matchup: `${id} vs X`,
    faceitScheduledAtIso: sentIso,
    terminalNotifiedAt: sentIso,
    postCastReminderSentAt: sentIso,
    ...extra
  };
}

const requests = [
  owed('a1', '1', '2026-11-04T03:00:00Z'),
  owed('b1', '2', '2026-11-03T03:00:00Z'),
  owed('b2', '2', '2026-11-05T03:00:00Z', { postCastNudgeSentAt: '2026-11-07T03:00:00Z' }),
  owed('c1', '3', '2026-11-03T01:00:00Z'),
  owed('done', '1', '2026-11-03T03:00:00Z', { postCastFormSubmittedAt: 'x', postCastFormSource: 'form' }),
  owed('waived', '4', '2026-11-03T03:00:00Z', { postCastFormWaivedAt: 'x', postCastFormSource: 'staff' }),
  owed('old', '5', '2026-10-20T03:00:00Z'),
  owed('withdrawn', '6', '2026-11-03T03:00:00Z', { status: 'withdrawn' }),
  { id: 'no-dm', requesterId: '7', status: 'approved', terminalNotifiedAt: '2026-11-03T03:00:00Z' }
];

test('groupMissingForms groups missing forms by caster, most missing and longest waiting first', () => {
  const groups = groupMissingForms(requests, { since });
  assert.deepEqual(groups.map((group) => [group.requesterId, group.requests.map((request) => request.id)]), [
    ['2', ['b1', 'b2']],
    ['3', ['c1']],
    ['1', ['a1']]
  ]);
  assert.equal(groups[0].requesterTag, 'caster2');
});

test('without a cutoff, older missing forms are included too', () => {
  const groups = groupMissingForms(requests);
  assert.ok(groups.some((group) => group.requesterId === '5'));
});

test('the report lists each caster with their casts, request IDs and nudge status', () => {
  const report = buildMissingFormsReport(groupMissingForms(requests, { since }), { since });
  assert.equal(report.total, 4);
  assert.deepEqual(report.casterIds, ['2', '3', '1']);
  const text = report.description;
  assert.match(text, /^\*\*4\*\* missing form\(s\) from \*\*3\*\* caster\(s\) since <t:\d+:D>\./);
  assert.match(text, /<@2> \(caster2\) · 2 missing\n- b1 vs X · <t:\d+:D> · `b1` · not nudged\n- b2 vs X · <t:\d+:D> · `b2` · nudged <t:\d+:R>/);
  assert.match(text, /form_received/);
  assert.doesNotMatch(text, /could not be checked/);
});

test('the report caps each caster and the number of casters, and notes a failed sheet check', () => {
  const many = [
    ...Array.from({ length: 7 }, (_, index) => owed(`x${index}`, '1', `2026-11-0${index + 2}T03:00:00Z`)),
    ...Array.from({ length: 4 }, (_, index) => owed(`y${index}`, String(10 + index), '2026-11-03T03:00:00Z'))
  ];
  const report = buildMissingFormsReport(groupMissingForms(many, { since }), { maxCasters: 3, sheetCheckFailed: true });
  assert.equal(report.casterIds.length, 3);
  assert.match(report.description, /- …and 2 more/);
  assert.match(report.description, /2 more caster\(s\) not shown\./);
  assert.match(report.description, /could not be checked just now/);
  assert.ok(report.description.length <= 4096);
});

test('an empty report says every form is in', () => {
  assert.equal(buildMissingFormsReport([]).description, '✅ Every post-cast form is in.');
  assert.match(buildMissingFormsReport([], { sheetCheckFailed: true }).description, /could not be checked/);
});

test('the staff nudge DM lists every missing form with its own link', () => {
  const groups = groupMissingForms(requests, { since });
  const text = buildStaffFormNudge(groups[0].requests, { formLink: (id) => `https://forms.example/?id=${id}`, gate: true });
  assert.match(text, /^📝 Tournament Operations is still waiting on 2 post-cast stats forms from you:/);
  assert.match(text, /- \*\*b1 vs X\*\* \(request b1\): https:\/\/forms\.example\/\?id=b1/);
  assert.match(text, /- \*\*b2 vs X\*\* \(request b2\): https:\/\/forms\.example\/\?id=b2/);
  assert.match(text, /next stream request is blocked/);
  const single = buildStaffFormNudge([groups[1].requests[0]]);
  assert.match(single, /^📝 Tournament Operations is still waiting on your post-cast stats form:/);
  assert.doesNotMatch(single, /https|blocked/);
});

test('staff can nudge the same caster once an hour', () => {
  const now = Date.parse('2026-11-08T12:00:00Z');
  assert.equal(staffNudgeCooldownUntil([owed('a', '1', since)], now), null);
  const recent = owed('a', '1', since, { postCastStaffNudgeAt: '2026-11-08T11:30:00Z' });
  assert.equal(staffNudgeCooldownUntil([recent], now), Date.parse('2026-11-08T12:30:00Z'));
  const stale = owed('a', '1', since, { postCastStaffNudgeAt: '2026-11-08T10:30:00Z' });
  assert.equal(staffNudgeCooldownUntil([stale], now), null);
});
