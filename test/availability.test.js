import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCellTimes,
  parseAvailabilityCell,
  parseAvailabilityTab,
  parseAvailability,
  availabilityAt,
  rankCrewForRole,
  peopleMissingWeek,
  parseHeaderDate,
  sheetSlotFor,
  statusFromHue,
  formatMinutes,
  mondayOf
} from '../src/availability.js';

const GREEN = '#b6d7a8';
const YELLOW = '#ffe599';
const RED = '#ea9999';
const PURPLE = '#b4a7d6';
const BLUE = '#9fc5e8';
const ORANGE = '#f9cb9c';
const PINK = '#d5a6bd';
const TEAL = '#a2c4c9';
const WHITE = '#ffffff';
const legend = {
  statuses: [
    { color: GREEN, status: 'free' },
    { color: YELLOW, status: 'maybe' },
    { color: RED, status: 'busy' },
    { color: PURPLE, status: 'partial' }
  ],
  roles: []
};

// 9:30 PM ET on Thursday 11/12/2026 (EST, UTC-5).
const THURS_930 = Date.UTC(2026, 10, 13, 2, 30);
const h = (hour, minute = 0) => hour * 60 + minute;

test('cell text times are read in Eastern time', () => {
  assert.deepEqual(parseCellTimes('8:00PM START'), { windows: [], latestStart: h(20), busyText: false });
  assert.deepEqual(parseCellTimes('After 7 EST').windows, [[h(19), h(28)]]);
  assert.deepEqual(parseCellTimes('7-8 EST//After 9:30EST').windows, [[h(19), h(20)], [h(21, 30), h(28)]]);
  assert.deepEqual(parseCellTimes('8-10pm').windows, [[h(20), h(22)]]);
  assert.deepEqual(parseCellTimes('9pm-12am').windows, [[h(21), h(24)]]);
  assert.deepEqual(parseCellTimes('11-1am').windows, [[h(23), h(25)]]);
  assert.deepEqual(parseCellTimes('7-9 EST Team Prac'), { windows: [[h(19), h(21)]], latestStart: null, busyText: true });
  assert.deepEqual(parseCellTimes('after 7 CST').windows, [[h(20), h(28)]], 'Central is an hour behind Eastern');
  assert.deepEqual(parseCellTimes('8pm+').windows, [[h(20), h(28)]]);
  assert.equal(parseCellTimes('Austin LAN').busyText, true);
});

test('day cells combine the legend colour and the text', () => {
  assert.deepEqual(parseAvailabilityCell('', WHITE, legend), { s: 'empty' });
  assert.equal(parseAvailabilityCell('', GREEN, legend).s, 'free');
  assert.equal(parseAvailabilityCell('', '#b7d7a9', legend).s, 'free', 'a slightly different shade still matches');
  assert.equal(parseAvailabilityCell('', YELLOW, legend).s, 'maybe');
  assert.equal(parseAvailabilityCell('', RED, legend).s, 'busy');
  assert.equal(parseAvailabilityCell('8:00PM START', PURPLE, legend).ls, h(20));
  assert.equal(parseAvailabilityCell('Austin LAN', WHITE, legend).s, 'busy');
  assert.equal(parseAvailabilityCell('FQR vs CLST - CF', WHITE, legend).s, 'busy');
  assert.equal(parseAvailabilityCell('all day', WHITE, legend).s, 'free');
  assert.equal(parseAvailabilityCell('7-9 EST Team Prac', GREEN, legend).s, 'busyDuring');
  assert.equal(statusFromHue('#00ff00'), 'free');
  assert.equal(statusFromHue('#ff0000'), 'busy');
  assert.equal(statusFromHue(WHITE), null);
});

test('availability at a match time', () => {
  const person = (cell) => ({ name: 'X', roles: ['caster'], days: { '2026-11-12': cell } });
  assert.equal(availabilityAt(person({ s: 'free' }), THURS_930).state, 'free');
  assert.equal(availabilityAt(person({ s: 'empty' }), THURS_930).state, 'unknown');
  assert.equal(availabilityAt(person({ s: 'windows', ls: h(22) }), THURS_930).state, 'free', 'latest start 10 PM covers a 9:30 start');
  assert.equal(availabilityAt(person({ s: 'windows', ls: h(20) }), THURS_930).state, 'busy', 'latest start 8 PM does not');
  const leavesEarly = availabilityAt(person({ s: 'windows', w: [[h(20), h(22)]] }), THURS_930, 180);
  assert.deepEqual(leavesEarly, { state: 'partial', note: 'free until 10 PM' });
  assert.equal(availabilityAt(person({ s: 'windows', w: [[h(21), h(28)]] }), THURS_930, 180).state, 'free');
  assert.equal(availabilityAt(person({ s: 'busyDuring', b: [[h(19), h(21)]], base: 'free' }), THURS_930).state, 'free', 'practice is over by 9:30');
  assert.equal(availabilityAt(person({ s: 'busyDuring', b: [[h(21), h(23)]], base: 'free' }), THURS_930).state, 'busy');
  // 12:30 AM Friday counts as Thursday night.
  assert.deepEqual(sheetSlotFor(Date.UTC(2026, 10, 13, 5, 30)), { dateKey: '2026-11-12', minutes: h(24, 30) });
  assert.equal(formatMinutes(h(22)), '10 PM');
  assert.equal(formatMinutes(h(24, 30)), '12:30 AM');
});

test('a PROD SCHEDULE tab is read with its legend, roles and week blocks', () => {
  const values = [
    ['Talent', 'Monday 11/09/2026', 'Tuesday 11/10/2026', 'Wednesday 11/11/2026', 'Thursday 11/12/2026', '', 'Schedule Colors and Role Colors'],
    ['Alderia', '', '', '', '', '', 'Can Work'],
    ['Zeph', '8:00PM START', '', 'Austin LAN', 'Austin LAN', '', 'Could Work'],
    ['Protoanz', '', '', '', '', '', 'Cant Work'],
    ['Floofys', '', '', '', '8-10pm', '', 'Free for partial a day?'],
    ['', '', '', '', '', '', 'PRODUCER ONLY'],
    ['', '', '', '', '', '', 'COLOR'],
    ['', '', '', '', '', '', ''],
    ['Talent', 'Monday 11/16/2026', 'Tuesday 11/17/2026', 'Wednesday 11/18/2026', 'Thursday 11/19/2026', '', ''],
    ['Alderia', '', 'After 8', '', '', '', '']
  ];
  const backgrounds = values.map((row) => row.map(() => WHITE));
  backgrounds[1][6] = GREEN; backgrounds[2][6] = YELLOW; backgrounds[3][6] = RED; backgrounds[4][6] = PURPLE;
  backgrounds[5][6] = BLUE; backgrounds[6][6] = PINK;
  backgrounds[1][0] = PINK; // Alderia: COLOR (caster)
  backgrounds[3][0] = BLUE; // Protoanz: PRODUCER ONLY
  backgrounds[1][4] = GREEN; // Alderia free Thursday
  backgrounds[3][4] = GREEN; // Protoanz free Thursday
  backgrounds[4][4] = PURPLE;
  const tab = parseAvailabilityTab({ name: 'PROD SCHEDULE', values, backgrounds }, { referenceYear: 2026 });
  assert.equal(tab.legendFound, true);
  const byName = Object.fromEntries(tab.people.map((person) => [person.name, person]));
  assert.deepEqual(byName.Alderia.roles, ['caster']);
  assert.deepEqual(byName.Protoanz.roles, ['producer']);
  assert.deepEqual(byName.Zeph.roles, ['caster', 'producer', 'observer'], 'no role colour = any production role');
  assert.equal(byName.Alderia.days['2026-11-12'].s, 'free');
  assert.equal(byName.Alderia.days['2026-11-17'].s, 'windows', 'second week block');
  assert.equal(byName.Zeph.days['2026-11-12'].s, 'busy');
  assert.equal(tab.dateKeys.length, 8);

  const parsed = parseAvailability([{ name: 'PROD SCHEDULE', values, backgrounds }], { referenceYear: 2026 });
  const casters = rankCrewForRole(parsed.people, 'caster', THURS_930, 180, { workCount: (person) => (person.name === 'Alderia' ? 2 : 0) });
  assert.deepEqual(casters.map((entry) => [entry.person.name, entry.state, entry.worked]), [
    ['Alderia', 'free', 2],
    ['Floofys', 'partial', 0],
    ['Zeph', 'busy', 0]
  ]);
  const producers = rankCrewForRole(parsed.people, 'producer', THURS_930, 180, { bookedElsewhere: (person) => person.name === 'Protoanz' });
  assert.equal(producers.find((entry) => entry.person.name === 'Protoanz').state, 'busy');

  const missing = peopleMissingWeek(parsed, '2026-11-16');
  assert.deepEqual(missing.people.map((person) => person.name).sort(), ['Floofys', 'Protoanz', 'Zeph']);
  assert.deepEqual(peopleMissingWeek(parsed, '2026-11-23').missingTabs, ['PROD SCHEDULE'], 'a week not on the sheet yet is reported, not nagged');
});

test('header dates and week helpers', () => {
  assert.equal(parseHeaderDate('Monday 11/09/2026'), '2026-11-09');
  assert.equal(parseHeaderDate('Thurs 11/12', 2026), '2026-11-12');
  assert.equal(parseHeaderDate('November 2–4'), null);
  assert.equal(mondayOf('2026-11-15'), '2026-11-09');
  assert.equal(mondayOf('2026-11-09'), '2026-11-09');
});

test('a whole day: availability summary and day parsing', async () => {
  const { dayAvailability, parseDayKey } = await import('../src/availability.js');
  const person = { days: {
    '2026-11-12': { s: 'free' },
    '2026-11-13': { s: 'windows', w: [[h(20), h(22)], [h(21, 30), h(28)]], base: 'free' },
    '2026-11-14': { s: 'windows', ls: h(20), base: 'free' },
    '2026-11-15': { s: 'busyDuring', b: [[h(19), h(21)]], base: 'free' },
    '2026-11-16': { s: 'busy', t: 'Austin LAN' }
  } };
  assert.deepEqual(dayAvailability(person, '2026-11-12'), { state: 'free', note: 'all day' });
  assert.deepEqual(dayAvailability(person, '2026-11-13'), { state: 'partial', note: '8 PM–10 PM, after 9:30 PM' });
  assert.deepEqual(dayAvailability(person, '2026-11-14'), { state: 'partial', note: 'latest start 8 PM' });
  assert.deepEqual(dayAvailability(person, '2026-11-15'), { state: 'partial', note: 'busy 7 PM–9 PM' });
  assert.deepEqual(dayAvailability(person, '2026-11-16'), { state: 'busy', note: 'Austin LAN' });
  assert.deepEqual(dayAvailability(person, '2026-11-17'), { state: 'unknown', note: 'not filled in' });
  assert.equal(parseDayKey('today', '2026-11-09'), '2026-11-09');
  assert.equal(parseDayKey('', '2026-11-09'), '2026-11-09');
  assert.equal(parseDayKey('tomorrow', '2026-11-09'), '2026-11-10');
  assert.equal(parseDayKey('thursday', '2026-11-09'), '2026-11-12');
  assert.equal(parseDayKey('monday', '2026-11-09'), '2026-11-09', 'the same weekday means today');
  assert.equal(parseDayKey('11/12', '2026-11-09'), '2026-11-12');
  assert.equal(parseDayKey('nov 12', '2026-11-09'), '2026-11-12');
  assert.equal(parseDayKey('9pm', '2026-11-09'), null);
});
