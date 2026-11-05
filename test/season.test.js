import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LEGACY_SEASON_SEED,
  currentSeason,
  easternDateKey,
  findSeasonByRef,
  findSeasonRound,
  formatRoundsText,
  isKnownRoundName,
  makeSeasonId,
  parseRoundsText,
  parseSeasonDate,
  parseSeasonTime,
  planDeleteSeason,
  planStartSeason,
  planUpdateSeason,
  roundKey,
  roundWindowForDisplay,
  seasonForDate
} from '../src/season.js';

const season7 = { ...LEGACY_SEASON_SEED, rounds: LEGACY_SEASON_SEED.rounds.map((round) => ({ ...round })) };

test('parseSeasonDate reads the common date formats', () => {
  assert.equal(parseSeasonDate('2026-11-02'), '2026-11-02');
  assert.equal(parseSeasonDate('11/2', { defaultYear: 2026 }), '2026-11-02');
  assert.equal(parseSeasonDate('11/2/2026'), '2026-11-02');
  assert.equal(parseSeasonDate('11/2/27'), '2027-11-02');
  assert.equal(parseSeasonDate('Nov 2', { defaultYear: 2026 }), '2026-11-02');
  assert.equal(parseSeasonDate('November 2nd, 2026'), '2026-11-02');
  assert.equal(parseSeasonDate('Mon, Nov 2', { defaultYear: 2026 }), '2026-11-02');
  assert.equal(parseSeasonDate('Sept 9', { defaultYear: 2026 }), '2026-09-09');
  assert.equal(parseSeasonDate('2/30/2026'), null);
  assert.equal(parseSeasonDate('Novembr 40'), null);
  assert.equal(parseSeasonDate(''), null);
  assert.equal(parseSeasonDate('next week'), null);
});

test('a date without a year rolls into next year when it would land far in the past', () => {
  assert.equal(parseSeasonDate('1/10', { defaultYear: 2026, after: '2026-11-05' }), '2027-01-10');
  assert.equal(parseSeasonDate('11/1', { defaultYear: 2026, after: '2026-11-05' }), '2026-11-01');
});

test('parseSeasonTime reads 12- and 24-hour times and rejects a bare number', () => {
  assert.equal(parseSeasonTime('8 PM'), '20:00');
  assert.equal(parseSeasonTime('8:30pm ET'), '20:30');
  assert.equal(parseSeasonTime('12:00 AM'), '00:00');
  assert.equal(parseSeasonTime('12 pm'), '12:00');
  assert.equal(parseSeasonTime('20:00'), '20:00');
  assert.equal(parseSeasonTime('8'), null);
  assert.equal(parseSeasonTime('13 PM'), null);
});

test('round names from FACEIT and staff resolve to the same round', () => {
  assert.equal(roundKey('WB Round of 32'), roundKey('Upper Bracket - Round 1'));
  assert.equal(roundKey('Losers Final'), roundKey('Lower Bracket - Round 8'));
  assert.equal(roundKey('Grand Final'), roundKey('Grand Final (BO5)'));
  assert.equal(roundKey('Group Stage - Round 2'), 'round 2');
  assert.equal(roundKey('Round 2'), 'round 2');
  assert.equal(isKnownRoundName('Upper Bracket - Round 3'), true);
  assert.equal(isKnownRoundName('Playoff Stage'), true);
  assert.equal(isKnownRoundName('Showmatch'), false);
});

test('parseRoundsText reads one round per line with an optional default time', () => {
  const { rounds, errors, warnings } = parseRoundsText([
    '# comment lines are skipped',
    'Group Stage | 11/2 - 11/11 | 11/6',
    'Round 1 | Nov 2 to Nov 4 | Nov 3 at 8:00 PM ET',
    '',
    'WB Round of 32 | 12/1 - 12/3 | 12/2 8 PM',
    'Grand Final | 1/9/2027'
  ].join('\n'), season7);
  assert.deepEqual(errors, []);
  assert.deepEqual(rounds, [
    { name: 'Group Stage', startDate: '2026-11-02', endDate: '2026-11-11', defaultDate: '2026-11-06', defaultTime: null },
    { name: 'Round 1', startDate: '2026-11-02', endDate: '2026-11-04', defaultDate: '2026-11-03', defaultTime: '20:00' },
    { name: 'WB Round of 32', startDate: '2026-12-01', endDate: '2026-12-03', defaultDate: '2026-12-02', defaultTime: '20:00' },
    { name: 'Grand Final', startDate: '2027-01-09', endDate: '2027-01-09', defaultDate: null, defaultTime: null }
  ]);
  assert.deepEqual(warnings, []);
});

test('a playoff round in January without a year lands in the next year', () => {
  const { rounds, errors } = parseRoundsText('Grand Final | 1/8 - 1/10 | 1/9 8 PM', season7);
  assert.deepEqual(errors, []);
  assert.equal(rounds[0].startDate, '2027-01-08');
  assert.equal(rounds[0].defaultDate, '2027-01-09');
});

test('parseRoundsText reports bad lines and saves nothing', () => {
  const { errors } = parseRoundsText([
    'Round 1 | 11/2 - 11/4',
    'Round 2',
    'Round 3 | 11/9 - 11/8',
    'Round 4 | sometime',
    'Round 5 | 11/2 - 11/4 | tuesday-ish',
    'Group Stage - Round 1 | 11/2 - 11/4'
  ].join('\n'), season7);
  assert.equal(errors.length, 5);
  assert.match(errors[0], /^Line 2:/);
  assert.match(errors[1], /^Line 3: the end date is before/);
  assert.match(errors[2], /^Line 4: could not read the dates/);
  assert.match(errors[3], /^Line 5: could not read the default/);
  assert.match(errors[4], /^Line 6: .* same round as line 1/);
});

test('parseRoundsText warns about odd names and dates outside the window', () => {
  const { errors, warnings } = parseRoundsText([
    'Showmatch | 11/20 - 11/21',
    'Round 1 | 11/2 - 11/4 | 11/8 8 PM',
    'Round 2 | 10/30 - 11/1'
  ].join('\n'), { ...season7, endDate: '2026-11-30' });
  assert.deepEqual(errors, []);
  assert.equal(warnings.length, 3);
  assert.match(warnings[0], /not a standard round name/);
  assert.match(warnings[1], /default date outside its own window/);
  assert.match(warnings[2], /outside the season dates/);
});

test('formatRoundsText round-trips through parseRoundsText', () => {
  const withPlayoffs = { ...season7, rounds: [...season7.rounds, { name: 'Grand Final (BO5)', startDate: '2027-01-08', endDate: '2027-01-10', defaultDate: '2027-01-09', defaultTime: '20:00' }] };
  const text = formatRoundsText(withPlayoffs);
  assert.match(text, /^Group Stage \| Nov 2 - Nov 11 \| Nov 6$/m);
  assert.match(text, /^Round 1 \| Nov 2 - Nov 4 \| Nov 3 8:00 PM$/m);
  assert.match(text, /^Grand Final \(BO5\) \| Jan 8, 2027 - Jan 10, 2027 \| Jan 9, 2027 8:00 PM$/m);
  const reparsed = parseRoundsText(text, withPlayoffs);
  assert.deepEqual(reparsed.errors, []);
  assert.deepEqual(reparsed.rounds, withPlayoffs.rounds);
});

test('the seeded season reproduces the old hard-coded Group Stage windows', () => {
  assert.deepEqual(roundWindowForDisplay(findSeasonRound(season7, ['Round 1', 'Group Stage'])), {
    name: 'Round 1',
    start: 'November 2, 2026',
    end: 'November 4, 2026',
    defaultDate: 'November 3, 2026',
    defaultDateTime: 'November 3, 2026 at 8:00 PM ET'
  });
  const groupStage = roundWindowForDisplay(findSeasonRound(season7, ['Group Stage']));
  assert.equal(groupStage.start, 'November 2, 2026');
  assert.equal(groupStage.end, 'November 11, 2026');
  assert.equal(groupStage.defaultDateTime, null);
  // The scheduling code parses window edges as "<date> 12:00 AM EST" / "<date> 11:59 PM EST".
  assert.equal(new Date(Date.parse(`${groupStage.start} 12:00 AM EST`)).toISOString(), '2026-11-02T05:00:00.000Z');
  assert.equal(new Date(Date.parse(`${groupStage.end} 11:59 PM EST`)).toISOString(), '2026-11-12T04:59:00.000Z');
});

test('findSeasonRound tries names in order and maps FACEIT playoff names', () => {
  const season = { ...season7, rounds: [...season7.rounds, { name: 'Upper Bracket - Round 1', startDate: '2026-12-01', endDate: '2026-12-03' }] };
  assert.equal(findSeasonRound(season, ['Round 4', 'Group Stage']).name, 'Group Stage');
  assert.equal(findSeasonRound(season, ['WB Round of 32']).name, 'Upper Bracket - Round 1');
  assert.equal(findSeasonRound(season, ['Grand Final']), null);
  assert.equal(findSeasonRound(null, ['Round 1']), null);
});

test('currentSeason prefers the running season, then the next one, never a finished one', () => {
  const seasons = [
    { id: 's6', name: 'Season 6', startDate: '2026-08-01', endDate: '2026-10-11' },
    { id: 's7', name: 'Season 7', startDate: '2026-11-02', endDate: '2026-12-20' },
    { id: 's8', name: 'Season 8', startDate: '2027-01-10', endDate: null }
  ];
  assert.equal(currentSeason(seasons, '2026-11-05').id, 's7');
  assert.equal(currentSeason(seasons, '2026-12-20').id, 's7');
  assert.equal(currentSeason(seasons, '2026-12-25').id, 's8');
  assert.equal(currentSeason(seasons, '2027-06-01').id, 's8');
  assert.equal(currentSeason(seasons.slice(0, 1), '2026-11-05'), null);
  assert.equal(seasonForDate(seasons, '2026-12-25'), null);
  assert.equal(seasonForDate(seasons, '2026-09-01').id, 's6');
});

test('starting a season closes the open-ended one the day before', () => {
  const result = planStartSeason([season7], { id: 'season-8', name: 'Season 8', startDate: '2027-01-10', endDate: '2027-03-15', actorId: '1' });
  assert.equal(result.error, undefined);
  assert.equal(result.closed.length, 1);
  assert.equal(result.seasons.find((season) => season.id === 'season-7').endDate, '2027-01-09');
  assert.equal(result.season.name, 'Season 8');
  assert.deepEqual(result.season.rounds, []);
  assert.equal(season7.endDate, null, 'the input list is not modified');
});

test('season changes that overlap, duplicate or reverse dates are refused', () => {
  const closed = { ...season7, endDate: '2026-12-20' };
  assert.match(planStartSeason([closed], { id: 'x', name: 'Season 8', startDate: '2026-12-01' }).error, /overlap/);
  assert.match(planStartSeason([closed], { id: 'x', name: 'season 7', startDate: '2027-01-10' }).error, /already a season called/);
  assert.match(planStartSeason([season7], { id: 'x', name: 'Season 6', startDate: '2026-10-01', endDate: '2026-11-10' }).error, /overlap/);
  assert.match(planUpdateSeason([closed], 'season-7', { endDate: '2026-10-01' }).error, /end before it starts/);
  assert.match(planUpdateSeason([closed], 'missing', { name: 'x' }).error, /no longer exists/);
});

test('editing, ending and deleting a season', () => {
  const renamed = planUpdateSeason([season7], 'season-7', { name: '  Season 7 Fall  ' });
  assert.equal(renamed.season.name, 'Season 7 Fall');
  const ended = planUpdateSeason([season7], 'season-7', { endDate: '2026-12-20' });
  assert.equal(ended.season.endDate, '2026-12-20');
  assert.equal(ended.season.rounds.length, 4);
  const deleted = planDeleteSeason([season7], 'season-7');
  assert.deepEqual(deleted.seasons, []);
});

test('helpers for ids, lookups and Eastern dates', () => {
  assert.equal(makeSeasonId('Season 8', []), 'season-season-8');
  assert.equal(makeSeasonId('Season 8', [{ id: 'season-season-8' }]), 'season-season-8-2');
  assert.equal(findSeasonByRef([season7], 'SEASON 7').id, 'season-7');
  assert.equal(findSeasonByRef([season7], 'season-7').id, 'season-7');
  assert.equal(findSeasonByRef([season7], 'Season 9'), null);
  // 02:00 UTC on Nov 6 is still Nov 5 in New York.
  assert.equal(easternDateKey(new Date('2026-11-06T02:00:00Z')), '2026-11-05');
});
