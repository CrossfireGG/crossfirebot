import assert from 'node:assert/strict';
import test from 'node:test';

import { upsertAndSortScheduleRows } from '../src/googleSheets.js';

test('adds approved schedule rows and sorts them by scheduled time', () => {
  const existingRows = [
    [
      '2026-09-10T01:00:00.000Z',
      'Later Team vs Other Team',
      'Later Team',
      'Other Team',
      'Group Stage',
      '1',
      'A',
      'September 6, 2026 at 8:00 PM EST',
      '2026-09-07T00:00:00.000Z',
      'America/New_York',
      'https://www.faceit.com/en/cs2/room/1-later',
      '222',
      'https://discord.com/channels/1/222',
      '1',
      '2',
      '3',
      'schedule'
    ],
    [
      '2026-09-10T00:00:00.000Z',
      'Team One vs Team Two',
      'Team One',
      'Team Two',
      'Group Stage',
      '1',
      'A',
      'September 4, 2026 at 9:00 PM EST',
      '2026-09-05T01:00:00.000Z',
      'America/New_York',
      'https://www.faceit.com/en/cs2/room/1-old',
      '111',
      'https://discord.com/channels/1/111',
      '1',
      '2',
      '3',
      'schedule'
    ]
  ];

  const rows = upsertAndSortScheduleRows(existingRows, {
    approvedAt: '2026-09-10T02:00:00.000Z',
    matchName: 'Team Three vs Team Four',
    teamA: 'Team Three',
    teamB: 'Team Four',
    stage: 'Group Stage',
    round: '1',
    group: 'A',
    scheduledAt: 'September 5, 2026 at 8:00 PM EST',
    scheduledAtIso: '2026-09-06T00:00:00.000Z',
    timezone: 'America/New_York',
    faceitUrl: 'https://www.faceit.com/en/cs2/room/1-new',
    discordChannelId: '333',
    discordChannelUrl: 'https://discord.com/channels/1/333',
    proposedBy: '4',
    acceptedBy: '5',
    approvedBy: '6',
    kind: 'schedule'
  });

  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row[1]), [
    'Team One vs Team Two',
    'Team Three vs Team Four',
    'Later Team vs Other Team'
  ]);
});

test('replaces old approved schedule row only when the match is rescheduled', () => {
  const existingRows = [
    [
      '2026-09-10T01:00:00.000Z',
      'Later Team vs Other Team',
      'Later Team',
      'Other Team',
      'Group Stage',
      '1',
      'A',
      'September 6, 2026 at 8:00 PM EST',
      '2026-09-07T00:00:00.000Z',
      'America/New_York',
      'https://www.faceit.com/en/cs2/room/1-later',
      '222',
      'https://discord.com/channels/1/222',
      '1',
      '2',
      '3',
      'schedule'
    ],
    [
      '2026-09-10T00:00:00.000Z',
      'Team One vs Team Two',
      'Team One',
      'Team Two',
      'Group Stage',
      '1',
      'A',
      'September 4, 2026 at 9:00 PM EST',
      '2026-09-05T01:00:00.000Z',
      'America/New_York',
      'https://www.faceit.com/en/cs2/room/1-old',
      '111',
      'https://discord.com/channels/1/111',
      '1',
      '2',
      '3',
      'schedule'
    ]
  ];

  const rows = upsertAndSortScheduleRows(existingRows, {
    approvedAt: '2026-09-10T02:00:00.000Z',
    matchName: 'Team One vs Team Two',
    teamA: 'Team One',
    teamB: 'Team Two',
    stage: 'Group Stage',
    round: '1',
    group: 'A',
    scheduledAt: 'September 5, 2026 at 8:00 PM EST',
    scheduledAtIso: '2026-09-06T00:00:00.000Z',
    timezone: 'America/New_York',
    faceitUrl: 'https://www.faceit.com/en/cs2/room/1-new',
    discordChannelId: '111',
    discordChannelUrl: 'https://discord.com/channels/1/111',
    proposedBy: '4',
    acceptedBy: '5',
    approvedBy: '6',
    kind: 'reschedule'
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row[1]), [
    'Team One vs Team Two',
    'Later Team vs Other Team'
  ]);
  assert.equal(rows[0][7], 'September 5, 2026 at 8:00 PM EST');
  assert.equal(rows[0][15], '6');
  assert.equal(rows[0][16], 'reschedule');
});
