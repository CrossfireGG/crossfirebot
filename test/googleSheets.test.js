import assert from 'node:assert/strict';
import test from 'node:test';

import { buildScheduleSheetRows } from '../src/googleSheets.js';

test('adds approved schedules under date sections sorted by time', () => {
  const rows = buildScheduleSheetRows([], {
    teamA: 'Team One',
    teamB: 'Team Two',
    round: '1',
    group: 'A',
    scheduledAt: 'September 5, 2026 at 8:00 PM EST',
    scheduledAtIso: '2026-09-06T00:00:00.000Z',
    timezone: 'America/New_York',
    faceitUrl: 'https://www.faceit.com/en/cs2/room/1-one',
    kind: 'schedule'
  });

  assert.deepEqual(rows, [
    ['Saturday, September 5, 2026', '', '', '', '', ''],
    ['8:00 PM EDT', 'Team One', 'Team Two', 'https://www.faceit.com/en/cs2/room/1-one', '1', 'A']
  ]);
});

test('approved schedule updates an already scheduled match instead of duplicating it', () => {
  const existingRows = [
    ['Friday, September 4, 2026', '', '', '', '', ''],
    ['9:00 PM EDT', 'Team One', 'Team Two', 'https://www.faceit.com/en/cs2/room/1-one', '1', 'A'],
    ['', '', '', '', '', ''],
    ['Sunday, September 6, 2026', '', '', '', '', ''],
    ['8:00 PM EDT', 'Later Team', 'Other Team', 'https://www.faceit.com/en/cs2/room/1-later', '1', 'B']
  ];

  const rows = buildScheduleSheetRows(existingRows, {
    teamA: 'Team One',
    teamB: 'Team Two',
    round: '1',
    group: 'A',
    scheduledAt: 'September 5, 2026 at 8:00 PM EST',
    scheduledAtIso: '2026-09-06T00:00:00.000Z',
    timezone: 'America/New_York',
    faceitUrl: 'https://www.faceit.com/en/cs2/room/1-one',
    kind: 'schedule'
  });

  const matchRows = rows.filter((row) => row[3]?.includes('faceit.com'));
  assert.equal(matchRows.length, 2);
  assert.deepEqual(matchRows.map((row) => row[1]), ['Team One', 'Later Team']);
  assert.equal(matchRows[0][0], '8:00 PM EDT');
});

test('writes FACEIT map result scores into the team columns when available', () => {
  const rows = buildScheduleSheetRows([], {
    teamA: 'Team One',
    teamB: 'Team Two',
    teamAScore: 2,
    teamBScore: 1,
    round: '2',
    group: 'C',
    scheduledAt: 'September 5, 2026 at 8:00 PM EST',
    scheduledAtIso: '2026-09-06T00:00:00.000Z',
    timezone: 'America/New_York',
    faceitUrl: 'https://www.faceit.com/en/cs2/room/1-score',
    kind: 'schedule'
  });

  assert.deepEqual(rows[1], [
    '8:00 PM EDT',
    'Team One (2)',
    'Team Two (1)',
    'https://www.faceit.com/en/cs2/room/1-score',
    '2',
    'C'
  ]);
});
