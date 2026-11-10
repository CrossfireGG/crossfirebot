import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCasterFormsView,
  buildFormsOverview,
  buildStaffFormNudge,
  formsCasterSummaries,
  groupMissingForms,
  selectFormCasts,
  staffNudgeCooldownUntil,
  MAINSTREAM_FORMS_ID,
  mainStreamFormId,
  isMainStreamFormId,
  mainStreamFormRequest,
  buildMainStreamFormMessage,
  postCastFormLink,
  isPostCastNudgeDue
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
  const text = buildStaffFormNudge(owed, { formLink: (request) => `https://forms.example/?id=${request.id}`, gate: true });
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

test('main stream forms: one MainStream row, its own request ID, channel message with pings', () => {
  assert.equal(mainStreamFormId('1-36be8795-1134-48a6-9d36-6a000d46e316'), 'MS-36BE8795');
  assert.equal(isMainStreamFormId('MS-36BE8795'), true);
  assert.equal(isMainStreamFormId('SR-12'), false);

  const coverage = {
    matchId: '1-36be8795-1134-48a6-9d36-6a000d46e316',
    matchup: 'Old Meta vs O Fire',
    faceitUrl: 'https://www.faceit.com/en/cs2/room/1-36be8795-1134-48a6-9d36-6a000d46e316',
    postCastForm: { id: 'MS-36BE8795', postCastReminderSentAt: '2026-11-10T04:00:00Z' }
  };
  assert.equal(mainStreamFormRequest({ ...coverage, postCastForm: null }), null, 'nothing until the form is posted');
  const form = mainStreamFormRequest(coverage, { startIso: '2026-11-10T02:00:00Z', streamUrl: 'https://twitch.tv/playcrossfire' });
  assert.equal(form.requesterId, MAINSTREAM_FORMS_ID);
  assert.equal(form.requesterTag, 'MainStream');
  assert.equal(form.status, 'approved');

  // /cf forms: the main stream form sits next to casters as one MainStream row.
  const requests = [cast('SR-1', 'u1', '2026-11-05T00:00:00Z'), form];
  const summaries = formsCasterSummaries(requests, { since });
  assert.deepEqual(summaries.map((row) => row.tag), ['casteru1', 'MainStream']);
  assert.match(buildFormsOverview(summaries), /❌ 🎥 \*\*MainStream\*\* · 1 missing/);
  assert.equal(groupMissingForms(requests, { since }).find((group) => group.requesterId === MAINSTREAM_FORMS_ID).requests[0].id, 'MS-36BE8795');
  const view = buildCasterFormsView(requests, { casterId: MAINSTREAM_FORMS_ID, since });
  assert.match(view.description, /^🎥 \*\*MainStream\*\* · \*\*0 of 1\*\* forms in/);
  assert.match(view.description, /❌ \*\*Old Meta vs O Fire\*\*/);

  // The pre-filled link uses the main stream URL and the match day.
  const template = 'https://forms.example/viewform?usp=pp_url&entry.1={requestId}&entry.2={streamUrl}&entry.3={streamDate}&entry.4={matchup}';
  const link = postCastFormLink(template, null, form, { timeZone: 'America/New_York' });
  assert.equal(link, 'https://forms.example/viewform?usp=pp_url&entry.1=MS-36BE8795&entry.2=https%3A%2F%2Ftwitch.tv%2Fplaycrossfire&entry.3=2026-11-09&entry.4=Old%20Meta%20vs%20O%20Fire');

  // The channel post pings the main stream form people; reminders say so.
  const formLink = (request) => `https://forms.example/${request.id}`;
  assert.equal(buildMainStreamFormMessage([form], { formLink, userIds: ['111', '222'] }),
    [
      '📝 Main stream post-cast stats form (match details already filled in):',
      '- **Old Meta vs O Fire** (request `MS-36BE8795`): <https://forms.example/MS-36BE8795>',
      '<@111> <@222>'
    ].join('\n'));
  assert.match(buildMainStreamFormMessage([form, form], { formLink, userIds: ['111'], reminder: true }), /^📝 Still waiting on 2 main stream post-cast stats forms:/);

  // The 48-hour reminder applies to main stream forms like any cast.
  assert.equal(isPostCastNudgeDue(form, Date.parse('2026-11-12T05:00:00Z'), { since }), true);
  assert.equal(isPostCastNudgeDue({ ...form, postCastFormSubmittedAt: '2026-11-10T05:00:00Z' }, Date.parse('2026-11-12T05:00:00Z'), { since }), false);
});
