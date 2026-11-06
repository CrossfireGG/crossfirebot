import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AppsScriptScheduleSheet,
  LogOnlyScheduleSheet,
  buildScheduleSheetRow,
  buildStreamLinkSheetRow,
  createScheduleSheet,
  splitScheduleForSheet
} from '../src/scheduleSheet.js';

const quietLog = { info() {}, warn() {}, error() {} };

test('schedule split always formats date and time in Eastern Time', () => {
  // 2026-11-03T01:00Z is Nov 2, 8:00 PM in New York (EST).
  assert.deepEqual(
    splitScheduleForSheet({ scheduledAtIso: '2026-11-03T01:00:00.000Z', timezone: 'America/New_York' }),
    { date: 'Mon, November 2, 2026', time: '8:00 PM EST' }
  );
  assert.deepEqual(
    splitScheduleForSheet({ scheduledAtIso: '2026-11-08T02:00:00.000Z', timezone: 'America/Chicago' }),
    { date: 'Sat, November 7, 2026', time: '9:00 PM EST' }
  );
  assert.deepEqual(
    splitScheduleForSheet({ scheduledAtIso: null, scheduledAt: 'Tuesday 8 PM ET' }),
    { date: 'Tuesday 8 PM ET', time: '' }
  );
});

test('sheet row carries the sheet columns plus match context', () => {
  const row = buildScheduleSheetRow({
    stored: { match: { id: '1-abc', teamA: 'Alpha', teamB: 'Bravo', faceitUrl: 'https://www.faceit.com/en/cs2/room/1-abc' } },
    proposal: { scheduledAtIso: '2026-11-03T01:00:00.000Z', scheduledAt: 'Mon, Nov 2, 2026, 8:00 PM EST', timezone: 'America/New_York', kind: 'reschedule', proposedBy: '1' },
    details: { stage: 'Group Stage', round: '2', group: 'Group K' },
    approvedBy: '7',
    acceptedBy: '2'
  });
  assert.equal(row.date, 'Mon, November 2, 2026');
  assert.equal(row.time, '8:00 PM EST');
  assert.equal(row.team1, 'Alpha');
  assert.equal(row.team2, 'Bravo');
  assert.equal(row.faceitLink, 'https://www.faceit.com/en/cs2/room/1-abc');
  assert.equal(row.round, '2');
  assert.equal(row.group, 'K');
  assert.equal(row.matchId, '1-abc');
  assert.equal(row.kind, 'reschedule');
  assert.equal(row.approvedBy, '7');
  assert.equal(row.acceptedBy, '2');
});

test('log-only sheet is selected without a webhook URL', async () => {
  const sheet = createScheduleSheet({ scheduleSheetWebhookUrl: null }, { log: quietLog });
  assert.ok(sheet instanceof LogOnlyScheduleSheet);
  assert.deepEqual(await sheet.append({ team1: 'A', team2: 'B', date: '', time: '' }), { ok: true, skipped: true, error: null });
});

function fakeFetch(response) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return { status: response.status, text: async () => response.body ?? '' };
  };
  return { fetchImpl, calls };
}

test('Apps Script sheet posts the secret and row and reads the JSON outcome', async () => {
  const { fetchImpl, calls } = fakeFetch({ status: 200, body: '{"status":200,"ok":true,"row":4,"updated":true}' });
  const sheet = new AppsScriptScheduleSheet({ webhookUrl: 'https://script.google.com/macros/s/x/exec', secret: 's3cret', fetchImpl, log: quietLog });
  const result = await sheet.append({ date: '11/02/2026', time: '8:00 PM EST', team1: 'Alpha', team2: 'Bravo', faceitLink: 'https://faceit/1' });
  assert.deepEqual(result, { ok: true, skipped: false, error: null, row: 4, updated: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'POST');
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.secret, 's3cret');
  assert.equal(sent.action, 'schedule');
  assert.equal(sent.row.team1, 'Alpha');
});

test('stream link row is built from an approved caster request', () => {
  const row = buildStreamLinkSheetRow({
    id: 'SR-1',
    matchId: '1-abc',
    matchup: 'Alpha vs Bravo',
    faceitUrl: 'https://www.faceit.com/en/cs2/room/1-abc',
    streamUrl: 'https://twitch.tv/caster',
    streamPlatform: 'twitch',
    faceitScheduledAtIso: '2026-11-03T01:00:00.000Z',
    requesterId: '42',
    requesterTag: 'caster#0001'
  }, { approvedBy: '7' });
  assert.equal(row.faceitLink, 'https://www.faceit.com/en/cs2/room/1-abc');
  assert.equal(row.streamUrl, 'https://twitch.tv/caster');
  assert.equal(row.team1, 'Alpha');
  assert.equal(row.team2, 'Bravo');
  assert.equal(row.requestId, 'SR-1');
  assert.equal(row.approvedBy, '7');
});

test('Apps Script sheet posts stream links with the streamLink action', async () => {
  const { fetchImpl, calls } = fakeFetch({ status: 200, body: '{"status":200,"ok":true,"row":9,"duplicate":true,"links":2}' });
  const sheet = new AppsScriptScheduleSheet({ webhookUrl: 'https://x/exec', secret: 's3cret', fetchImpl, log: quietLog });
  const result = await sheet.addStreamLink({ faceitLink: 'https://faceit/1', streamUrl: 'https://twitch.tv/caster' });
  assert.deepEqual(result, { ok: true, skipped: false, error: null, row: 9, duplicate: true });
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.action, 'streamLink');
  assert.equal(sent.row.streamUrl, 'https://twitch.tv/caster');

  const missingRow = new AppsScriptScheduleSheet({ webhookUrl: 'https://x/exec', secret: 'k', fetchImpl: fakeFetch({ status: 200, body: '{"status":404,"ok":false,"error":"no row on the Game Schedules tab has FACEIT link https://faceit/1"}' }).fetchImpl, log: quietLog });
  assert.match((await missingRow.addStreamLink({ faceitLink: 'https://faceit/1', streamUrl: 'y' })).error, /no row on the Game Schedules tab/);

  const logOnly = new LogOnlyScheduleSheet({ log: quietLog });
  assert.deepEqual(await logOnly.addStreamLink({ streamUrl: 'y', team1: 'A', team2: 'B', faceitLink: 'f' }), { ok: true, skipped: true, error: null });
});

test('Apps Script sheet looks up post-cast form responses by request ID', async () => {
  const { fetchImpl, calls } = fakeFetch({ status: 200, body: '{"status":200,"ok":true,"found":{"SR-2":{"submittedAt":"2026-11-05T02:00:00.000Z","row":14}}}' });
  const sheet = new AppsScriptScheduleSheet({ webhookUrl: 'https://x/exec', secret: 's3cret', fetchImpl, log: quietLog });
  const result = await sheet.lookupPostCastForms(['SR-1', 'SR-2']);
  assert.deepEqual(result, { ok: true, skipped: false, error: null, found: { 'SR-2': { submittedAt: '2026-11-05T02:00:00.000Z', row: 14 } } });
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.action, 'postCastForms');
  assert.deepEqual(sent.requestIds, ['SR-1', 'SR-2']);

  const broken = new AppsScriptScheduleSheet({ webhookUrl: 'https://x/exec', secret: 'k', fetchImpl: fakeFetch(new Error('socket hang up')).fetchImpl, log: quietLog });
  assert.deepEqual(await broken.lookupPostCastForms(['SR-1']), { ok: false, skipped: false, error: 'socket hang up', found: {} });

  const logOnly = new LogOnlyScheduleSheet({ log: quietLog });
  assert.deepEqual(await logOnly.lookupPostCastForms(['SR-1']), { ok: true, skipped: true, error: null, found: {} });
});

test('Apps Script sheet removes stream links with the removeStreamLink action', async () => {
  const { fetchImpl, calls } = fakeFetch({ status: 200, body: '{"status":200,"ok":true,"row":9,"removed":true,"links":1}' });
  const sheet = new AppsScriptScheduleSheet({ webhookUrl: 'https://x/exec', secret: 's3cret', fetchImpl, log: quietLog });
  const result = await sheet.removeStreamLink({ faceitLink: 'https://faceit/1', streamUrl: 'https://twitch.tv/caster' });
  assert.deepEqual(result, { ok: true, skipped: false, error: null, row: 9, removed: true });
  assert.equal(JSON.parse(calls[0].init.body).action, 'removeStreamLink');

  const gone = new AppsScriptScheduleSheet({ webhookUrl: 'https://x/exec', secret: 'k', fetchImpl: fakeFetch({ status: 200, body: '{"status":200,"ok":true,"row":0,"removed":false,"links":0}' }).fetchImpl, log: quietLog });
  assert.deepEqual(await gone.removeStreamLink({ faceitLink: 'f', streamUrl: 'y' }), { ok: true, skipped: false, error: null, row: 0, removed: false });

  const logOnly = new LogOnlyScheduleSheet({ log: quietLog });
  assert.deepEqual(await logOnly.removeStreamLink({ streamUrl: 'y', team1: 'A', team2: 'B', faceitLink: 'f' }), { ok: true, skipped: true, error: null });
});

test('Apps Script sheet reports bad secrets, HTML pages, and network errors without throwing', async () => {
  const denied = new AppsScriptScheduleSheet({ webhookUrl: 'https://x/exec', secret: 'k', fetchImpl: fakeFetch({ status: 200, body: '{"status":401,"ok":false,"error":"bad secret"}' }).fetchImpl, log: quietLog });
  assert.match((await denied.append({})).error, /bad secret/);

  const html = new AppsScriptScheduleSheet({ webhookUrl: 'https://x/exec', secret: 'k', fetchImpl: fakeFetch({ status: 200, body: '<html>Sign in</html>' }).fetchImpl, log: quietLog });
  assert.match((await html.append({})).error, /Anyone/);

  const down = new AppsScriptScheduleSheet({ webhookUrl: 'https://x/exec', secret: 'k', fetchImpl: fakeFetch(new Error('socket hang up')).fetchImpl, log: quietLog });
  assert.deepEqual(await down.append({}), { ok: false, skipped: false, error: 'socket hang up' });

  const serverError = new AppsScriptScheduleSheet({ webhookUrl: 'https://x/exec', secret: 'k', fetchImpl: fakeFetch({ status: 500, body: 'boom' }).fetchImpl, log: quietLog });
  assert.match((await serverError.append({})).error, /HTTP 500: boom/);
});
