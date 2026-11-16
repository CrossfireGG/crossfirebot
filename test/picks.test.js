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
  leaderChangeText,
  lockTimeText,
  moverText,
  picksCommandText,
  PICKS_SCORING_TABLE,
  picksInfoText,
  picksLinks,
  rankMap,
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

test('movers: places gained or lost since the last update', () => {
  const previous = rankMap([entry('A', 9, 3, 4), entry('B', 8, 3, 4), entry('C', 7, 2, 4), entry('D', 1, 1, 4)]);
  assert.deepEqual(previous, { 'u-A': 1, 'u-B': 2, 'u-C': 3, 'u-D': 4 });
  assert.equal(moverText(previous, 'u-D', 1), ' ▲3');
  assert.equal(moverText(previous, 'u-A', 3), ' ▼2');
  assert.equal(moverText(previous, 'u-B', 2), '', 'unchanged');
  assert.equal(moverText(previous, 'u-new', 2), '', 'not on the last board');
  assert.equal(moverText(null, 'u-A', 1), '');
  const lines = standingsLines([entry('D', 12, 4, 5), entry('B', 9, 3, 5), entry('A', 9, 3, 5)], 10, { previousRanks: previous });
  assert.match(lines[0], /^\*\*1\.\*\* D ▲3 · /);
  assert.match(lines[1], /^\*\*2\.\*\* B · /);
  assert.match(lines[2], /^\*\*3\.\*\* A ▼2 · /);
  assert.equal(leaderChangeText({ leader: entry('D', 12, 4, 5), previousName: 'A_x', eventName: 'S7' }), '👑 **New leader in the S7 bracket picks:** D (12 pts) takes first place from A\\_x.');
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

// A fake Picks channel. `sent` is every new message ({ id, title, description, content }),
// `edits` every edit of one, `pinned` the pinned message ids and `messages` the messages still
// there (delete one to see it re-posted).
function fakeBot(site, clock, { eventId = 'crossfire-season-7', finishedGames = null } = {}) {
  const sent = [];
  const edits = [];
  const pinned = [];
  const messages = new Map();
  const shape = (payload) => ({ content: payload.content || '', ...(payload.embeds?.[0]?.toJSON() || {}), allowedMentions: payload.allowedMentions });
  const channel = {
    id: 'picks',
    isTextBased: () => true,
    send: async (payload) => {
      const message = { id: `m${sent.length + 1}`, ...shape(payload), pin: async () => { pinned.push(message.id); } };
      message.edit = async (next) => {
        Object.assign(message, shape(next));
        edits.push({ id: message.id, content: message.content });
      };
      sent.push(message);
      messages.set(message.id, message);
      return message;
    },
    messages: { fetch: async (id) => messages.get(id) || Promise.reject(Object.assign(new Error('Unknown Message'), { code: 10008 })) }
  };
  const client = { channels: { fetch: async (id) => (id === 'picks' ? channel : null) }, guilds: { fetch: async () => null } };
  const config = {
    picksEnabled: true,
    picksBaseUrl: 'https://www.crossfiregg.com',
    picksEventId: eventId,
    picksEventName: 'Season 7 Playoffs',
    picksChannelId: 'picks',
    picksTotalMatches: 0,
    defaultTimezone: 'America/New_York',
    websiteTimeoutSeconds: 10
  };
  const make = () => createPicks({ client, config, fetchImpl: site.fetch, now: () => clock.ms, finishedGames });
  return { sent, edits, pinned, messages, make };
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

test('the info message: the full scoring, as one plain Discord message', () => {
  const text = picksInfoText({ eventName: 'Season 7 Playoffs', links, entries: 47 });
  assert.ok(text.length <= 2000, `fits one Discord message (${text.length})`);
  assert.match(text, /^# 🏆 Season 7 Playoffs Bracket Picks\n/);
  assert.match(text, /\*\*47 brackets in\*\*/);
  assert.match(text, /<https:\/\/www\.crossfiregg\.com\/picks\/leaderboard>/, 'the link shows no preview card');
  assert.match(text, /Round 1 \(16 matches\) +1 +\+1\n/);
  assert.match(text, /Lower final +8 +\+4\n/);
  assert.match(text, /GRAND FINAL +12 +\+6\n/);
  assert.match(text, /\*\*Every winner right:\*\* 212 points · \*\*every winner and every score right:\*\* 318 points/);
  assert.match(text, /Walkovers pay the winner points but no score bonus\./);
  assert.match(text, /Ties on the leaderboard break by number of correct winners, then name\.$/);
  assert.equal(PICKS_SCORING_TABLE.filter((line) => /^Round|final/i.test(line)).length, 14, 'every upper, lower and grand final row');
});

test('reminders, the locked post, the two kept messages, the leader note and the final post', async () => {
  const site = fakeSite();
  const clock = { ms: LOCK_MS - 25 * HOUR };
  const { sent, edits, pinned, messages, make } = fakeBot(site, clock);
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
  // "Picks are locked", then the info message and the leaderboard go up straight away.
  assert.equal(sent.length, 6);
  assert.equal(sent[3].title, '🔒 Picks are locked');
  assert.match(sent[3].description, /9 brackets in/);
  assert.match(sent[4].content, /^# 🏆 Season 7 Playoffs Bracket Picks/);
  assert.match(sent[4].content, /## How points work/);
  assert.match(sent[5].content, /^## 📊 Season 7 Playoffs leaderboard: top 2\n/);
  assert.match(sent[5].content, /\*\*View all 2 brackets:\*\* <https:\/\/www\.crossfiregg\.com\/picks\/leaderboard>/);
  assert.match(sent[5].content, /\[A\]\(<https:\/\/www\.crossfiregg\.com\/picks\/u-A>\)/, 'each name opens that bracket');
  assert.doesNotMatch(sent[5].content, /[▲▼]/, 'no arrows on the first leaderboard');
  assert.equal(sent[5].title, undefined, 'plain messages, not embeds');
  assert.deepEqual(pinned, ['m5', 'm6'], 'the info and the leaderboard are pinned, the other posts are not');
  clock.ms += 11 * MIN;
  await picks.tick();
  assert.equal(sent.length, 6);
  assert.equal(edits.length, 0, 'nothing changed, nothing edited');

  // A result comes in: the leaderboard message is edited, and first place changed hands.
  site.entries = [entry('B', 4, 2, 2), entry('A', 2, 1, 2)];
  clock.ms += 5 * MIN;
  await picks.tick();
  assert.equal(edits.length, 0, 'the leaderboard is only checked every 10 minutes');
  clock.ms += 6 * MIN;
  await picks.tick();
  assert.equal(edits.length, 1, 'only the leaderboard is edited; the info text did not change');
  assert.equal(edits[0].id, 'm6');
  assert.match(edits[0].content, /\*\*1\.\*\* \[B\]\([^)]+\) ▲1 · \*\*4 pts\*\* · 2\/2 correct\n\*\*2\.\*\* \[A\]\([^)]+\) ▼1 · /, 'site order, not re-sorted; movers marked');
  assert.match(edits[0].content, new RegExp(`-# Updated <t:${Math.floor(clock.ms / 1000)}:R> after every result · ▲▼ = places moved`));
  assert.equal(sent.length, 7, 'plus one leader note');
  assert.equal(sent[6].content, '👑 **New leader in the Season 7 Playoffs bracket picks:** B (4 pts) takes first place from A.');
  assert.deepEqual(sent[6].allowedMentions, { parse: [] }, 'pings nobody');
  assert.deepEqual(pinned, ['m5', 'm6'], 'the note is not pinned');

  picks = make(); // restart: same decided total, both messages still there, nothing happens
  await picks.tick();
  clock.ms += 11 * MIN;
  await picks.tick();
  assert.equal(sent.length, 7);
  assert.equal(edits.length, 1);

  // Someone deletes the leaderboard: a new one is posted (and pinned) on the next check.
  messages.delete('m6');
  clock.ms += 11 * MIN;
  await picks.tick();
  assert.equal(sent.length, 8);
  assert.match(sent[7].content, /leaderboard: top 2/);
  assert.match(sent[7].content, /\[B\]\([^)]+\) ▲1 /, 'a re-post keeps the arrows it had');
  assert.deepEqual(pinned, ['m5', 'm6', 'm8']);
  assert.equal(edits.length, 1);

  // The bracket ends: the leaderboard gets its last update, then the final post. Same leader,
  // so no note.
  site.entries = [entry('B', 80, 40, 62, 'EMPIRE'), entry('A', 70, 35, 62, 'Axial')];
  clock.ms += 11 * MIN;
  await picks.tick();
  assert.equal(edits.length, 2);
  assert.equal(edits[1].id, 'm8');
  assert.match(edits[1].content, /\*\*80 pts\*\*/);
  assert.doesNotMatch(edits[1].content, /[▲▼]/, 'nobody moved this time');
  assert.equal(sent.length, 9);
  assert.match(sent[8].title, /final standings/);
  assert.match(sent[8].description, /🏆 EMPIRE/);
  assert.equal(sent[8].fields[0].value, 'EMPIRE: 1\nAxial: 1');

  const calls = site.calls.length;
  clock.ms += 30 * MIN;
  await picks.tick();
  picks = make();
  await picks.tick();
  assert.equal(sent.length, 9);
  assert.equal(site.calls.length, calls, 'after the final post the site is left alone');

  const state = await store.getPicksState('crossfire-season-7');
  assert.deepEqual(Object.keys(state.reminders).sort(), ['24h', '30m', '3h']);
  assert.equal(state.decidedTotal, 124);
  assert.equal(state.infoMessageId, 'm5');
  assert.equal(state.standingsMessageId, 'm8');
  assert.equal(state.standingsChannelId, 'picks');
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

test('the leaderboard is checked after every finished game, and nothing pings', async () => {
  const site = fakeSite();
  site.info.locked = true;
  site.entries = [entry('A', 2, 1, 1), entry('B', 0, 0, 1)];
  const clock = { ms: LOCK_MS + HOUR };
  const games = { finished: 3, fail: false, asked: 0 };
  const finishedGames = async () => {
    games.asked += 1;
    if (games.fail) throw new Error('FACEIT is down');
    return games.finished;
  };
  const { sent, edits, make } = fakeBot(site, clock, { eventId: 'games-test', finishedGames });
  const picks = make();
  const siteChecks = () => site.calls.filter((call) => call.url.endsWith('/all')).length;

  await picks.tick(); // first run: locked post, info and leaderboard
  assert.equal(sent.length, 3);
  assert.equal(siteChecks(), 1);

  // No game finishes: the site is left alone (only the 30-minute safety check).
  for (let minute = 0; minute < 20; minute += 1) {
    clock.ms += MIN;
    await picks.tick();
  }
  assert.equal(siteChecks(), 1, 'no site checks while no game has finished');
  assert.ok(games.asked >= 9 && games.asked <= 11, `FACEIT is asked every 2 minutes (${games.asked})`);

  // A game finishes, but the site has not scored it yet: checked every minute until it has.
  games.finished = 4;
  clock.ms += 2 * MIN;
  await picks.tick();
  assert.equal(siteChecks(), 2, 'checked as soon as the game is seen finished');
  assert.equal(edits.length, 0, 'the site has no new result yet');
  clock.ms += MIN;
  await picks.tick();
  assert.equal(siteChecks(), 3);
  site.entries = [entry('B', 4, 2, 2), entry('A', 2, 1, 2)];
  clock.ms += MIN;
  await picks.tick();
  assert.equal(siteChecks(), 4);
  assert.equal(edits.length, 1, 'the leaderboard is edited');
  assert.equal(sent.length, 4, 'plus the leader note');

  // The result is in: back to waiting for the next game.
  for (let minute = 0; minute < 10; minute += 1) {
    clock.ms += MIN;
    await picks.tick();
  }
  assert.equal(siteChecks(), 4);

  // The safety check still runs every 30 minutes.
  clock.ms += 25 * MIN;
  await picks.tick();
  assert.equal(siteChecks(), 5);

  // FACEIT can't be read: back to checking the site every 10 minutes.
  games.fail = true;
  clock.ms += 3 * MIN;
  await picks.tick();
  clock.ms += 11 * MIN;
  await picks.tick();
  assert.equal(siteChecks(), 6);

  // Nothing the picks bot sends can ping anyone.
  for (const message of sent) assert.deepEqual(message.allowedMentions, { parse: [] });
});
