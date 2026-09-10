import assert from 'node:assert/strict';
import test from 'node:test';

import { planScheduleSheetUpdate } from '../src/googleSheets.js';

test('writes approved schedules into the formatted Game Schedule grid', () => {
  const existingRows = [
    ['', 'TIME', 'TEAM 1', 'TEAM 2', 'FACEIT LINK', 'ROUND', 'GROUP', 'Admin', 'Team 1 Score', 'Team 2 Score'],
    ['Monday, August 31, 2026', '', '', '', '', '', '', '', '', '']
  ];

  const plan = planScheduleSheetUpdate(existingRows, {
    teamA: 'Team One',
    teamB: 'Team Two',
    round: '1',
    group: 'A',
    scheduledAtIso: '2026-08-31T23:00:00.000Z',
    faceitUrl: 'https://www.faceit.com/en/cs2/room/1-one',
    approvedBy: 'Sandstorm'
  });

  assert.equal(plan.clearRanges.length, 0);
  assert.equal(plan.targetRowNumber, 2);
  assert.deepEqual(plan.updates, [{
    range: 'B2:J2',
    values: [['7:00 PM EST', 'Team One', 'Team Two', 'https://www.faceit.com/en/cs2/room/1-one', '1', 'A', 'Sandstorm', '', '']]
  }]);
});

test('rescheduling clears the old row and moves the same match to the new date', () => {
  const existingRows = [
    ['', 'TIME', 'TEAM 1', 'TEAM 2', 'FACEIT LINK', 'ROUND', 'GROUP', 'Admin', 'Team 1 Score', 'Team 2 Score'],
    ['Monday, August 31, 2026', '8:00 PM EST', 'Team One', 'Team Two', 'https://www.faceit.com/en/cs2/room/1-one', '1', 'A', 'Sandstorm', '', ''],
    ['Tuesday, September 1, 2026', '', '', '', '', '', '', '', '', '']
  ];

  const plan = planScheduleSheetUpdate(existingRows, {
    teamA: 'Team One',
    teamB: 'Team Two',
    round: '1',
    group: 'A',
    scheduledAtIso: '2026-09-02T00:00:00.000Z',
    faceitUrl: 'https://www.faceit.com/en/cs2/room/1-one',
    approvedBy: 'Crown'
  });

  assert.deepEqual(plan.clearRanges, ['B2:J2']);
  assert.equal(plan.targetRowNumber, 3);
  assert.equal(plan.moved, true);
  assert.deepEqual(plan.updates, [{
    range: 'B3:J3',
    values: [['8:00 PM EST', 'Team One', 'Team Two', 'https://www.faceit.com/en/cs2/room/1-one', '1', 'A', 'Crown', '', '']]
  }]);
});

test('writes FACEIT map result scores into separate score columns', () => {
  const existingRows = [
    ['', 'TIME', 'TEAM 1', 'TEAM 2', 'FACEIT LINK', 'ROUND', 'GROUP', 'Admin', 'Team 1 Score', 'Team 2 Score'],
    ['Saturday, September 5, 2026', '', '', '', '', '', '', '', '', '']
  ];

  const plan = planScheduleSheetUpdate(existingRows, {
    teamA: 'Team One',
    teamB: 'Team Two',
    teamAScore: 2,
    teamBScore: 1,
    round: '2',
    group: 'C',
    scheduledAtIso: '2026-09-06T00:00:00.000Z',
    faceitUrl: 'https://www.faceit.com/en/cs2/room/1-score',
    approvedBy: 'Sandstorm'
  });

  assert.deepEqual(plan.updates[0], {
    range: 'B2:J2',
    values: [['8:00 PM EST', 'Team One', 'Team Two', 'https://www.faceit.com/en/cs2/room/1-score', '2', 'C', 'Sandstorm', '2', '1']]
  });
});

test('sorts matches within the same date by time without touching column A', () => {
  const existingRows = [
    ['', 'TIME', 'TEAM 1', 'TEAM 2', 'FACEIT LINK', 'ROUND', 'GROUP', 'Admin', 'Team 1 Score', 'Team 2 Score'],
    ['Saturday, September 5, 2026', '9:00 PM EST', 'Late Team', 'Opponent', 'https://www.faceit.com/en/cs2/room/1-late', '3', 'K', '', '', ''],
    ['Saturday, September 5, 2026', '', '', '', '', '', '', '', '', '']
  ];

  const plan = planScheduleSheetUpdate(existingRows, {
    teamA: 'Early Team',
    teamB: 'Other Team',
    round: '3',
    group: 'B',
    scheduledAtIso: '2026-09-05T22:00:00.000Z',
    faceitUrl: 'https://www.faceit.com/en/cs2/room/1-early'
  });

  assert.deepEqual(plan.updates, [
    {
      range: 'B2:J2',
      values: [['6:00 PM EST', 'Early Team', 'Other Team', 'https://www.faceit.com/en/cs2/room/1-early', '3', 'B', '', '', '']]
    },
    {
      range: 'B3:J3',
      values: [['9:00 PM EST', 'Late Team', 'Opponent', 'https://www.faceit.com/en/cs2/room/1-late', '3', 'K', '', '', '']]
    }
  ]);
  assert.equal(plan.previewRows[1][0], 'Saturday, September 5, 2026');
  assert.equal(plan.previewRows[2][0], 'Saturday, September 5, 2026');
});
