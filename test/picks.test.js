import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// The store picks its file when first loaded, so point it at a temp file before loading anything
// that uses it (never the real bot-data.json).
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crossfire-picks-'));
process.env.BOT_DATA_PATH = path.join(tempDir, 'bot-data.json');
const store = await import('../src/store.js');
const {
  bracketComplete,
  bracketsInText,
  championTally,
  createPicks,
  createPicksApi,
  decidedTotal,
  dueReminder,
  lockTimeText,
  picksCommandText,
  picksLinks,
  standingsLines
} = await import('../src/picks.js');

const LOCKS_AT = '2026-11-15T01:00:00.000Z';
const LOCK_MS = Date.parse(LOCKS_AT);
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const links = picksLinks('https://www.crossfiregg.com/');

const entry = (name, total, correct, decided, champion = 'EMPIRE', picked = 62) => ({
  userId: `u-${name}`, name, image: null, champion, picked, score: { total, correct, wrong: decided - correct, decided }, updatedAt: LOCKS_AT
});

test('links, counts and the lock time in ET', () => {
  assert.equal(links.picks, 'https://www.crossfiregg.com/picks');
  assert.equal(links.leaderboard, 'https://www.crossfiregg.com/picks/leaderboard');
  assert.equal(picksLinks('https://x.gg', 'abc').entry, 'https://x.gg/picks/abc');
  assert.equal(bracketsInText(1), '1 bracket in');
  assert.equal(bracketsInText(42), '42 brackets in');
  assert.equal(lockTimeText(LOCKS_AT), 'Sat, Nov 14 at 8:00 PM ET');
});

test('reminders: due at 24 h, 3 h and 30 min, once each, skipped when missed', () => {
  assert.equal(dueReminder(LOCK_MS - 25 * HOUR, LOCK_MS), null);
  assert.equal(dueReminder(LOCK_MS - 24 * HOUR, LOCK_MS).key, '24h');
  assert.equal(dueReminder(LOCK_MS - 24 * HOUR + 30 * MIN, LOCK_MS).key, '24h');
  assert.equal(dueReminder(LOCK_MS - 24 * HOUR + 30 * MIN, LOCK_MS, { '24h': 'x' }), null, 'already posted');
  assert.equal(dueReminder(LOCK_MS - 20 * HOUR, LOCK_MS), null, 'missed by hours: not posted late');
  assert.equal(dueReminder(LOCK_MS - 3 * HOUR + MIN, LOCK_MS).key, '3h');
  assert.equal(dueReminder(LOCK_MS - 29 * MIN, LOCK_MS).key, '30m');
  assert.equal(dueReminder(LOCK_MS - 10 * MIN, LOCK_MS), null);
  assert.equal(dueReminder(LOCK_MS, LOCK_MS), null, 'nothing once locked');
});

test('standings keep the leaderboard order; decided total and completion', () => {
  const entries = [entry('B_ob', 30, 10, 12), entry('Al', 30, 11, 12, 'Axial'), entry('Cy', 5, 2, 12, null, 20)];
  const lines = standingsLines(entries, 2);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^\*\*1\.\*\* B\\_ob · \*\*30 pts\*\* · 10\/12 correct$/);
  assert.match(lines[1], /^\*\*2\.\*\* Al /);
  assert.match(standingsLines(entries, 10, { champions: true })[2], /no pick$/);
  assert.equal(decidedTotal(entries), 36);
  assert.equal(bracketComplete(entries), false);
  assert.equal(bracketComplete([entry('A', 90, 40, 62)]), true);
  assert.equal(bracketComplete([entry('A', 90, 40, 62)], 63), false, 'PICKS_TOTAL_MATCHES wins');
  assert.equal(bracketComplete([]), false);
  assert.deepEqual(championTally(entries), [{ team: 'EMPIRE', count: 1 }, { team: 'Axial', count: 1 }]);
});

test('/picks text before and after the lock', () => {
  const before = picksCommandText({ info: { locksAt: LOCKS_AT, locked: false, entries: 7 }, links, eventName: 'Season 7 Playoffs' });
  assert.match(before, /crossfiregg\.com\/picks\n/);
  assert.match(before, /Sat, Nov 14 at 8:00 PM ET/);
  assert.match(before, /7 brackets in/);
  const after = picksCommandText({
    info: { locksAt: LOCKS_AT, locked: true, entries: 4 },
    entries: [entry('A', 9, 3, 4), entry('B', 8, 3, 4), entry('C', 7, 2, 4), entry('D', 1, 1, 4)],
    links,
    eventName: 'Season 7 Playoffs'
  });
  assert.match(after, /picks\/leaderboard/);
  assert.match(after, /\*\*1\.\*\* A · 9 pts/);
  assert.match(after, /\*\*3\.\*\* C · 7 pts/);
  assert.doesNotMatch(after, /\*\*4\.\*\*/);
  assert.match(picksCommandText({ info: null, links, eventName: 'X' }), /did not answer/);
});

// A fake website: info and leaderboard are whatever the test sets.
function fakeSite() {
  const site = { info: { eventId: 'crossfire-season-7', locksAt: LOCKS_AT, locked: false, entries: 3, entrants: [] }, entries: [], calls: [] };
  site.fetch = async (url, options) => {
    site.calls.push({ url, options });
    const json = (status, body) => ({ status, text: async () => JSON.stringify(body) });
    if (url.endsWith('/all')) {
      return site.info.locked
        ? json(200, { locked: true, locksAt: site.info.locksAt, entries: site.entries })
        : json(403, { error: { code: 'not_locked', details: { locksAt: site.info.locksAt } } });
    }
    return json(200, site.info);
  };
  return site;
}

function fakeBot(site, clock) {
  const sent = [];
  const channel = { id: 'ann', isTextBased: () => true, send: async (payload) => { sent.push(payload.embeds[0].toJSON()); } };
  const client = { channels: { fetch: async (id) => (id === 'ann' ? channel : null) }, guilds: { fetch: async () => null } };
  const config = {
    picksEnabled: true,
    picksBaseUrl: 'https://www.crossfiregg.com',
    picksEventId: 'crossfire-season-7',
    picksEventName: 'Season 7 Playoffs',
    picksChannelId: 'ann',
    picksTotalMatches: 0,
    defaultTimezone: 'America/New_York',
    websiteTimeoutSeconds: 10
  };
  const make = () => createPicks({ client, config, fetchImpl: site.fetch, now: () => clock.ms });
  return { sent, make };
}

test('the API client: public GET, and 403 not_locked is "not yet"', async () => {
  const site = fakeSite();
  const api = createPicksApi({ baseUrl: 'https://www.crossfiregg.com', eventId: 'crossfire-season-7', fetchImpl: site.fetch });
  assert.equal((await api.getInfo()).entries, 3);
  assert.deepEqual(await api.getAll(), { locked: false, locksAt: LOCKS_AT, entries: [] });
  assert.equal(site.calls[0].url, 'https://www.crossfiregg.com/api/picks/crossfire-season-7');
  assert.equal(site.calls[1].url, 'https://www.crossfiregg.com/api/picks/crossfire-season-7/all');
  assert.equal(site.calls[0].options.headers.Authorization, undefined, 'no API key is sent');
  const flat = createPicksApi({ baseUrl: 'https://x', eventId: 'e', fetchImpl: async () => ({ status: 403, text: async () => JSON.stringify({ code: 'not_locked', locksAt: LOCKS_AT }) }) });
  assert.equal((await flat.getAll()).locksAt, LOCKS_AT);
  const down = createPicksApi({ baseUrl: 'https://x', eventId: 'e', fetchImpl: async () => ({ status: 502, text: async () => 'bad gateway' }) });
  await assert.rejects(down.getInfo(), /HTTP 502/);
  await assert.rejects(down.getAll(), /HTTP 502/);
});

test('reminders, the locked post, standings and the final post: each once, across restarts', async () => {
  const site = fakeSite();
  const clock = { ms: LOCK_MS - 25 * HOUR };
  const { sent, make } = fakeBot(site, clock);
  let picks = make();

  await picks.tick();
  assert.equal(sent.length, 0, 'nothing 25 hours out');

  clock.ms = LOCK_MS - 24 * HOUR + MIN;
  site.info.entries = 5;
  await picks.tick();
  assert.equal(sent.length, 1);
  assert.match(sent[0].title, /lock in 24 hours/);
  assert.match(sent[0].description, /5 brackets in/, 'the count is read again right before posting');
  assert.match(sent[0].description, /crossfiregg\.com\/picks/);
  await picks.tick();
  picks = make(); // restart
  await picks.tick();
  assert.equal(sent.length, 1, 'not posted twice');

  // The lock moves 2 hours earlier (the first match starts earlier): reminders follow the API.
  site.info.locksAt = new Date(LOCK_MS - 2 * HOUR).toISOString();
  const lockMs = LOCK_MS - 2 * HOUR;
  clock.ms = lockMs - 3 * HOUR + 11 * MIN;
  await picks.tick();
  assert.match(sent[1].title, /lock in 3 hours/);
  clock.ms = lockMs - 30 * MIN + 5 * MIN;
  await picks.tick();
  assert.match(sent[2].title, /lock in 30 minutes/);
  assert.equal(sent.length, 3);

  // Lock time has passed but the site has not flipped yet: wait for it.
  clock.ms = lockMs + MIN;
  await picks.tick();
  assert.equal(sent.length, 3);
  site.info.locked = true;
  site.info.entries = 9;
  site.entries = [entry('A', 0, 0, 0), entry('B', 0, 0, 0)];
  clock.ms += MIN;
  await picks.tick();
  assert.equal(sent.length, 4);
  assert.equal(sent[3].title, '🔒 Picks are locked');
  assert.match(sent[3].description, /9 brackets in/);
  clock.ms += 11 * MIN;
  await picks.tick();
  assert.equal(sent.length, 4, 'no standings while nothing is decided');

  site.entries = [entry('B', 4, 2, 2), entry('A', 2, 1, 2)];
  clock.ms += 5 * MIN;
  await picks.tick();
  assert.equal(sent.length, 4, 'the leaderboard is only checked every 10 minutes');
  clock.ms += 6 * MIN;
  await picks.tick();
  assert.equal(sent.length, 5);
  assert.match(sent[4].title, /top 2/);
  assert.match(sent[4].description, /\*\*1\.\*\* B · \*\*4 pts\*\* · 2\/2 correct\n\*\*2\.\*\* A /, 'site order, not re-sorted');
  assert.match(sent[4].description, /picks\/leaderboard/);

  picks = make(); // restart: same decided total, nothing new
  await picks.tick();
  clock.ms += 11 * MIN;
  await picks.tick();
  assert.equal(sent.length, 5);

  site.entries = [entry('B', 80, 40, 62, 'EMPIRE'), entry('A', 70, 35, 62, 'Axial')];
  clock.ms += 11 * MIN;
  await picks.tick();
  assert.equal(sent.length, 7);
  assert.match(sent[5].title, /top 2/);
  assert.match(sent[6].title, /final standings/);
  assert.match(sent[6].description, /🏆 EMPIRE/);
  assert.equal(sent[6].fields[0].value, 'EMPIRE: 1\nAxial: 1');

  const calls = site.calls.length;
  clock.ms += 30 * MIN;
  await picks.tick();
  picks = make();
  await picks.tick();
  assert.equal(sent.length, 7);
  assert.equal(site.calls.length, calls, 'after the final post the site is left alone');

  const state = await store.getPicksState('crossfire-season-7');
  assert.deepEqual(Object.keys(state.reminders).sort(), ['24h', '30m', '3h']);
  assert.equal(state.decidedTotal, 124);
  assert.ok(state.finalPostedAt);
});

test('/picks replies only to the person asking', async () => {
  const site = fakeSite();
  const { make } = fakeBot(site, { ms: LOCK_MS - HOUR });
  const replies = [];
  const interaction = { deferReply: async (options) => replies.push(options), editReply: async (payload) => replies.push(payload) };
  await make().handleCommand(interaction);
  assert.deepEqual(replies[0], { ephemeral: true });
  assert.match(replies[1].content, /3 brackets in/);

  site.info.locked = true;
  site.entries = [entry('Zed', 12, 5, 6)];
  await make().handleCommand(interaction);
  assert.match(replies[3].content, /picks\/leaderboard/);
  assert.match(replies[3].content, /\*\*1\.\*\* Zed · 12 pts/);
});
