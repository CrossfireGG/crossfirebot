import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AppsScriptScheduleSheet,
  LogOnlyScheduleSheet,
  buildScheduleSheetRow,
  createScheduleSheet,
  splitScheduleForSheet
} from '../src/scheduleSheet.js';

const quietLog = { info() {}, warn() {}, error() {} };

test('schedule split formats date and time in the proposal timezone', () => {
  // 2026-11-03T01:00Z is Nov 2, 8:00 PM in New York (EST).
  assert.deepEqual(
    splitScheduleForSheet({ scheduledAtIso: '2026-11-03T01:00:00.000Z', timezone: 'America/New_York' }),
    { date: 'Monday, November 2, 2026', time: '8:00 PM EST' }
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
  assert.equal(row.date, 'Monday, November 2, 2026');
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
  assert.equal(sent.row.team1, 'Alpha');
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
