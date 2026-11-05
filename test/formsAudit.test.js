import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFormsAuditReport, selectFormsAudit } from '../src/streamRequest.js';

const since = '2026-11-02T00:00:00Z';

function cast(id, requesterId, sentIso, extra = {}) {
  return {
    id,
    requesterId,
    status: 'approved',
    matchId: `match-${id}`,
    matchup: `${id} vs X`,
    faceitScheduledAtIso: sentIso,
    postCastReminderSentAt: sentIso,
    postCastReminderDelivery: 'delivered',
    ...extra
  };
}

const requests = [
  cast('missing-new', '1', '2026-11-06T03:00:00Z'),
  cast('missing-old', '2', '2026-11-03T03:00:00Z', { postCastNudgeSentAt: '2026-11-05T03:00:00Z' }),
  cast('dm-failed', '2', '2026-11-04T03:00:00Z', { postCastReminderDelivery: 'failed' }),
  cast('received', '1', '2026-11-05T03:00:00Z', { postCastFormSubmittedAt: '2026-11-05T06:00:00Z', postCastFormSource: 'form' }),
  cast('waived', '3', '2026-11-04T03:00:00Z', { postCastFormSubmittedAt: '2026-11-04T09:00:00Z', postCastFormWaivedAt: '2026-11-04T09:00:00Z', postCastFormWaivedBy: '99', postCastFormSource: 'staff' }),
  cast('before-cutoff', '1', '2026-10-20T03:00:00Z'),
  cast('withdrawn', '1', '2026-11-05T03:00:00Z', { status: 'withdrawn' }),
  { id: 'no-form-dm', requesterId: '1', status: 'approved' }
];

test('selectFormsAudit splits casts that got the form into missing and submitted, newest first', () => {
  const { missing, submitted } = selectFormsAudit(requests, { since });
  assert.deepEqual(missing.map((request) => request.id), ['missing-new', 'dm-failed', 'missing-old']);
  assert.deepEqual(submitted.map((request) => request.id), ['received', 'waived']);
});

test('selectFormsAudit filters by caster or by match', () => {
  const byCaster = selectFormsAudit(requests, { since, casterId: '2' });
  assert.deepEqual(byCaster.missing.map((request) => request.id), ['dm-failed', 'missing-old']);
  assert.deepEqual(byCaster.submitted, []);
  const byMatch = selectFormsAudit(requests, { since, matchId: 'match-received' });
  assert.deepEqual(byMatch.submitted.map((request) => request.id), ['received']);
  assert.deepEqual(byMatch.missing, []);
});

test('the forms report shows totals, then not submitted, then submitted', () => {
  const text = buildFormsAuditReport(selectFormsAudit(requests, { since }), { since });
  assert.match(text, /^\*\*5\*\* cast\(s\) got the post-cast form since <t:\d+:D>: ✅ 1 received · ☑️ 1 marked by staff · ❌ 3 missing/);
  assert.ok(text.indexOf('**Not submitted (3)**') < text.indexOf('**Submitted (2)**'));
  assert.match(text, /❌ \*\*missing-new vs X\*\* · <@1> · <t:\d+:D> · `missing-new` · form sent <t:\d+:R> · not nudged/);
  assert.match(text, /❌ \*\*missing-old vs X\*\* .* · nudged <t:\d+:R>/);
  assert.match(text, /❌ \*\*dm-failed vs X\*\* .*\(form DM failed: DMs closed\)/);
  assert.match(text, /✅ \*\*received vs X\*\* · <@1> · <t:\d+:D> · `received` · received <t:\d+:R>/);
  assert.match(text, /☑️ \*\*waived vs X\*\* .* · marked received by <@99> <t:\d+:R>/);
  assert.doesNotMatch(text, /before-cutoff|withdrawn|no-form-dm|could not be checked/);
});

test('the forms report names its scope, caps long lists and flags a failed sheet check', () => {
  const many = Array.from({ length: 30 }, (_, index) => cast(`m${index}`, '1', `2026-11-${String(3 + (index % 20)).padStart(2, '0')}T03:00:00Z`));
  const text = buildFormsAuditReport(selectFormsAudit(many, { since }), { since, scope: '<@1>', maxLines: 10, sheetCheckFailed: true });
  assert.match(text, /^\*\*30\*\* cast\(s\) for <@1> got the post-cast form/);
  assert.match(text, /…and 20 more\./);
  assert.match(text, /\*\*Submitted \(0\)\*\*\nNone\./);
  assert.match(text, /could not be checked just now/);
  assert.ok(text.length <= 4096);
});

test('an empty forms report says nobody has been sent the form', () => {
  assert.match(buildFormsAuditReport({ missing: [], submitted: [] }, { since, scope: 'match abc' }), /^No casts for match abc have been sent the post-cast form since <t:\d+:D>\.$/);
});
