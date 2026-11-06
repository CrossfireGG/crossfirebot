import test from 'node:test';
import assert from 'node:assert/strict';

import { buildOpenMatchesView, selectOpenMatches } from '../src/streamRequest.js';

const NOW = Date.parse('2026-11-05T18:00:00Z');

function stored(id, extra = {}) {
  return { match: { id, teamA: `${id}A`, teamB: `${id}B`, round: 'Round 2', faceitUrl: `https://www.faceit.com/en/cs2/room/${id}`, ...extra } };
}

function schedule(matchId, iso, adminApproved = true) {
  return { matchId, scheduledAtIso: iso, adminApproved };
}

const data = {
  matches: [
    stored('later'),
    stored('soon'),
    stored('pending'),
    stored('mine'),
    stored('taken'),
    stored('dropped'),
    stored('main'),
    stored('unapproved'),
    stored('past'),
    stored('finished', { status: 'FINISHED' }),
    stored('unscheduled')
  ],
  schedules: [
    schedule('later', '2026-11-08T01:00:00Z'),
    schedule('soon', '2026-11-06T01:00:00Z'),
    schedule('pending', '2026-11-06T02:00:00Z'),
    schedule('mine', '2026-11-06T03:00:00Z'),
    schedule('taken', '2026-11-06T01:00:00Z'),
    schedule('dropped', '2026-11-07T01:00:00Z'),
    schedule('main', '2026-11-06T01:00:00Z'),
    schedule('unapproved', '2026-11-06T01:00:00Z', false),
    schedule('past', '2026-11-05T01:00:00Z'),
    schedule('finished', '2026-11-06T01:00:00Z')
  ],
  requests: [
    { matchId: 'pending', status: 'pending', requesterId: '2' },
    { matchId: 'pending', status: 'denied', requesterId: '3' },
    { matchId: 'mine', status: 'pending', requesterId: '1' },
    { matchId: 'mine', status: 'pending', requesterId: '4' },
    { matchId: 'taken', status: 'approved', requesterId: '2' },
    { matchId: 'taken', status: 'pending', requesterId: '3' },
    { matchId: 'dropped', status: 'withdrawn', requesterId: '2' },
    { matchId: 'dropped', status: 'canceled', requesterId: '3' }
  ],
  mainStreamMatchIds: ['main']
};

test('every confirmed upcoming match is listed in time order with its coverage, main stream included', () => {
  const open = selectOpenMatches(data, { now: NOW, viewerId: '1' });
  assert.deepEqual(open.map((entry) => entry.matchId), ['soon', 'taken', 'main', 'pending', 'mine', 'dropped', 'later']);
  assert.deepEqual(open[0], {
    matchId: 'soon',
    matchup: 'soonA vs soonB',
    round: 'Round 2',
    faceitUrl: 'https://www.faceit.com/en/cs2/room/soon',
    startIso: '2026-11-06T01:00:00.000Z',
    mainStream: false,
    approved: 0,
    pending: 0,
    mine: null
  });
  assert.deepEqual([open[1].approved, open[1].pending, open[1].mine], [1, 1, null], 'a match with an approved caster stays listed for co-casters');
  assert.equal(open[2].mainStream, true);
  assert.equal(open[3].pending, 1, 'denied requests do not count as pending');
  assert.deepEqual([open[4].pending, open[4].mine], [2, 'pending']);
  assert.deepEqual([open[5].approved, open[5].pending], [0, 0], 'withdrawn and canceled requests do not count');
  assert.equal(selectOpenMatches(data, { now: NOW, viewerId: '2' })[1].mine, 'approved');
});

test('tonight gets its own highlighted section; later matches are grouped by day', () => {
  // NOW is 1 PM Eastern on Thursday, November 5. 01:00 UTC on the 6th is 8 PM Eastern on the 5th.
  const view = buildOpenMatchesView(selectOpenMatches(data, { now: NOW, viewerId: '1' }), { now: NOW });
  const [tonight, later] = view.embeds;
  assert.equal(tonight.title, '🔥 Tonight · Thurs, November 5');
  const lines = tonight.description.split('\n');
  assert.equal(lines.length, 5);
  assert.match(lines[0], /^<t:\d+:t> · \*\*soonA vs soonB\*\* · ❗ needs a caster · \[Matchroom\]\(https:\/\/www\.faceit\.com\/en\/cs2\/room\/soon\)$/);
  assert.match(lines[1], /\*\*takenA vs takenB\*\* · 🎙️ 1 caster · ⏳ 1 pending ·/);
  assert.match(lines[2], /\*\*mainA vs mainB\*\* · 📺 main stream ·/);
  assert.match(lines[4], /\*\*mineA vs mineB\*\* · ⏳ you requested this · ⏳ 1 pending ·/);
  assert.equal(later.title, '📅 Coming up');
  assert.match(later.description, /^\*\*Fri, November 6\*\*\n<t:\d+:t> · \*\*droppedA vs droppedB\*\* · ❗ needs a caster ·[^\n]*\n\n\*\*Sat, November 7\*\*\n<t:\d+:t> · \*\*laterA vs laterB\*\*/);
  assert.ok(later.footer && !tonight.footer, 'the footer goes on the last embed');
  assert.notEqual(tonight.color, later.color);
  assert.deepEqual(view.buttons.map((entry) => [entry.matchId, entry.tonight]), [
    ['soon', true], ['taken', true], ['pending', true], ['mine', true], ['dropped', false], ['later', false]
  ], 'main stream matches get no button');
  const asCaster = buildOpenMatchesView(selectOpenMatches(data, { now: NOW, viewerId: '2' }), { now: NOW }).embeds[0].description;
  assert.match(asCaster, /\*\*takenA vs takenB\*\* · ✅ you are casting this · ⏳ 1 pending/);
});

test('tonight is the current Eastern day, long lists are cut to one message, and an empty list says so', () => {
  const tomorrowOnly = buildOpenMatchesView(selectOpenMatches(data, { now: Date.parse('2026-11-06T05:00:00Z') }), { now: Date.parse('2026-11-06T05:00:00Z') });
  assert.deepEqual(tomorrowOnly.embeds.map((embed) => embed.title), ['🔥 Tonight · Fri, November 6', '📅 Coming up']);
  const many = Array.from({ length: 80 }, (_, index) => ({
    matchId: `m${index}`, matchup: `Team ${index} vs Team ${index + 1}`, round: 'Round 2', faceitUrl: `https://www.faceit.com/en/cs2/room/1-${'x'.repeat(36)}`,
    startIso: new Date(Date.parse('2026-11-07T01:00:00Z') + index * 3600000).toISOString(), mainStream: false, approved: 0, pending: 0, mine: null
  }));
  const view = buildOpenMatchesView(many, { now: NOW });
  assert.deepEqual(view.embeds.map((embed) => embed.title), ['📅 Coming up']);
  assert.match(view.embeds[0].description, /…and \d+ more after these\.$/);
  const total = view.embeds.reduce((sum, embed) => sum + (embed.title || '').length + embed.description.length + (embed.footer || '').length, 0);
  assert.ok(total < 6000, `embeds fit one message (${total})`);
  assert.equal(view.buttons.length, Math.min(25, 80 - Number(view.embeds[0].description.match(/…and (\d+) more/)[1])), 'one button per shown match, at most 25');
  assert.match(buildOpenMatchesView([]).embeds[0].description, /^No confirmed upcoming matches right now\./);
  assert.deepEqual(buildOpenMatchesView([]).buttons, []);
});

test('the daily post is due once per Eastern day, from 5 PM until 7 PM', async () => {
  const { openMatchesDigestDue } = await import('../src/streamRequest.js');
  // November 5, 2026 is Eastern standard time (UTC-5): 5 PM Eastern is 22:00 UTC.
  assert.equal(openMatchesDigestDue(Date.parse('2026-11-05T21:59:00Z')), null, 'not before 5 PM');
  assert.equal(openMatchesDigestDue(Date.parse('2026-11-05T22:00:00Z')), '2026-11-05');
  assert.equal(openMatchesDigestDue(Date.parse('2026-11-05T23:30:00Z')), '2026-11-05', 'a restart at 6:30 PM still posts');
  assert.equal(openMatchesDigestDue(Date.parse('2026-11-06T00:00:00Z')), null, 'after 7 PM the day is skipped');
  assert.equal(openMatchesDigestDue(Date.parse('2026-11-05T22:05:00Z'), { lastDateKey: '2026-11-05' }), null, 'only once a day');
  assert.equal(openMatchesDigestDue(Date.parse('2026-11-05T22:05:00Z'), { lastDateKey: '2026-11-04' }), '2026-11-05');
  // Summer (UTC-4): 5 PM Eastern is 21:00 UTC.
  assert.equal(openMatchesDigestDue(Date.parse('2026-07-01T21:00:00Z')), '2026-07-01');
  assert.equal(openMatchesDigestDue(Date.parse('2026-11-05T14:00:00Z'), { time: '09:00' }), '2026-11-05');
});

test('the channel post can use its own footer', async () => {
  const { UPCOMING_POST_FOOTER } = await import('../src/streamRequest.js');
  const view = buildOpenMatchesView(selectOpenMatches(data, { now: NOW }), { now: NOW, footer: UPCOMING_POST_FOOTER });
  assert.equal(view.embeds.at(-1).footer, 'Times are in your local time. Use /request open to request a match.');
});
