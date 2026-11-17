import assert from 'node:assert/strict';
import test from 'node:test';

import { gladiatorIds, gladiatorStatus } from '../src/gladiator.js';

const DAY = 86400000;
const START = Date.parse('2026-01-01T00:00:00Z');
// One finished game per day; `rosters[i]` is who played game i.
const history = (rosters) => rosters.map((ids, index) => ({
  id: `g${index}`,
  finishedAt: new Date(START + index * DAY).toISOString(),
  teams: [{ players: ids.map((id) => ({ id })) }, { players: [] }]
}));
const at = (index) => START + index * DAY;
const repeat = (count, ids) => Array.from({ length: count }, () => ids);

test('Gladiator is earned with 10 games ever and 3 of the last 20', () => {
  // p plays the first 9 games: enough recent games, but not 10 ever.
  const nine = history(repeat(9, ['p']));
  assert.equal(gladiatorStatus(nine, { nowMs: at(9) }).get('p').holds, false);
  const ten = history(repeat(10, ['p']));
  assert.equal(gladiatorStatus(ten, { nowMs: at(10) }).get('p').holds, true);

  // q has 10 games, then sits out 30 and comes back: 1 and 2 of the last 20 are not enough.
  const back = (games) => history([...repeat(10, ['x']), ...repeat(30, ['y']), ...repeat(games, ['x', 'y'])]);
  const strict = { minGames: 10, missLimit: 5, graceDays: 1 }; // x loses the role during the break
  assert.equal(gladiatorStatus(back(0), { nowMs: at(40), settings: strict }).get('x').holds, false);
  assert.equal(gladiatorStatus(back(2), { nowMs: at(42), settings: strict }).get('x').holds, false);
  assert.equal(gladiatorStatus(back(3), { nowMs: at(43), settings: strict }).get('x').holds, true);
});

test('20 missed games start a 14-day timer; one game clears it', () => {
  const games = (missed, extra = []) => history([...repeat(10, ['p', 'o']), ...repeat(missed, ['o']), ...extra]);
  // 19 missed: no timer, however long ago the last game was.
  const safe = gladiatorStatus(games(19), { nowMs: at(400) }).get('p');
  assert.deepEqual([safe.holds, safe.missed, safe.timerEndsMs], [true, 19, null]);
  // The 20th missed game (index 29) starts the timer.
  const timed = gladiatorStatus(games(20), { nowMs: at(30) }).get('p');
  assert.deepEqual([timed.holds, timed.missed, timed.timerEndsMs], [true, 20, at(29) + 14 * DAY]);
  // Still held on the last day, gone after it.
  assert.equal(gladiatorStatus(games(20), { nowMs: at(29) + 14 * DAY }).get('p').holds, true);
  assert.equal(gladiatorStatus(games(20), { nowMs: at(29) + 14 * DAY + 1 }).get('p').holds, false);
  // A game inside the timer clears it (played on day 35, timer would have ended on day 43).
  const saved = gladiatorStatus(games(25, [['p', 'o']]), { nowMs: at(60) }).get('p');
  assert.deepEqual([saved.holds, saved.missed, saved.timerEndsMs], [true, 0, null]);
  // A game after the timer ran out does not: the role has to be earned again.
  const late = history([...repeat(10, ['p', 'o']), ...repeat(20, ['o']), ...repeat(20, []).map(() => []), ['p', 'o']]);
  assert.equal(late.length, 51);
  assert.equal(gladiatorStatus(late, { nowMs: at(51) }).get('p').holds, false);
  assert.deepEqual([...gladiatorIds(late, { nowMs: at(51) })], ['o']);
});

test('veterans get 40 missed games, and one game brings the role back', () => {
  const settings = { veteranGames: 12 };
  const games = (missed, extra = []) => history([...repeat(12, ['v', 'o']), ...repeat(missed, ['o']), ...extra]);
  const leash = gladiatorStatus(games(39), { nowMs: at(400), settings }).get('v');
  assert.deepEqual([leash.holds, leash.veteran, leash.timerEndsMs], [true, true, null]);
  const timed = gladiatorStatus(games(40), { nowMs: at(52), settings }).get('v');
  assert.equal(timed.timerEndsMs, at(51) + 14 * DAY);
  // Lost after the timer, back with a single game (1 of the last 20).
  assert.equal(gladiatorStatus(games(60), { nowMs: at(72), settings }).get('v').holds, false);
  assert.equal(gladiatorStatus(games(60, [['v', 'o']]), { nowMs: at(73), settings }).get('v').holds, true);
  // Someone who is not a veteran needs 3 of the last 20 again.
  assert.equal(gladiatorStatus(games(60, [['v', 'o']]), { nowMs: at(73) }).get('v').holds, false);
});

test('missed games are counted from the day the role was switched on', () => {
  // p stopped after 10 games and 25 games have finished since: on a timer by the history.
  const games = (after) => history([...repeat(10, ['p', 'o']), ...repeat(25 + after, ['o'])]);
  assert.notEqual(gladiatorStatus(games(0), { nowMs: at(36) }).get('p').timerEndsMs, null);
  // Switched on just after the last of those games: p holds the role with nothing counted yet.
  const fresh = gladiatorStatus(games(0), { nowMs: at(36), countFromMs: at(34) + 1 }).get('p');
  assert.deepEqual([fresh.holds, fresh.missed, fresh.timerEndsMs], [true, 0, null]);
  // 19 more games: still no timer. The 20th (index 54) starts it; 14 days later the role goes.
  assert.equal(gladiatorStatus(games(19), { nowMs: at(400), countFromMs: at(34) + 1 }).get('p').timerEndsMs, null);
  const timed = gladiatorStatus(games(20), { nowMs: at(56), countFromMs: at(34) + 1 }).get('p');
  assert.deepEqual([timed.holds, timed.missed, timed.timerEndsMs], [true, 20, at(54) + 14 * DAY]);
  assert.equal(gladiatorStatus(games(20), { nowMs: at(54) + 14 * DAY + 1, countFromMs: at(34) + 1 }).get('p').holds, false);
  // Someone whose timer had already run out before the switch-on does not get the role.
  assert.equal(gladiatorStatus(games(0), { nowMs: at(60), countFromMs: at(60) }).get('p').holds, false);
});
