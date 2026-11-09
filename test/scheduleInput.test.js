import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeScheduleText, parseScheduleClock, correctDateWord } from '../src/scheduleInput.js';

test('infers an evening time when AM/PM is omitted', () => {
  assert.deepEqual(parseScheduleClock('November 6 9:00 EST'), {
    hour: 21,
    minute: 0,
    inferredEvening: true
  });
});

test('preserves explicit AM and PM times', () => {
  assert.deepEqual(parseScheduleClock('November 6 9:00 AM EST'), {
    hour: 9,
    minute: 0,
    inferredEvening: false
  });
  assert.deepEqual(parseScheduleClock('November 6 9 PM EST'), {
    hour: 21,
    minute: 0,
    inferredEvening: false
  });
});

test('preserves unambiguous 24-hour times', () => {
  assert.deepEqual(parseScheduleClock('November 6 21:30 EST'), {
    hour: 21,
    minute: 30,
    inferredEvening: true
  });
});

test('does not mistake a date without a clock for a time', () => {
  assert.equal(parseScheduleClock('November 6 EST'), null);
});

test('times typed without spaces, with a.m./p.m. or with typos are still read', () => {
  assert.deepEqual(parseScheduleClock('11/09/2026 8:30est'), { hour: 20, minute: 30, inferredEvening: true });
  assert.deepEqual(parseScheduleClock('11/9 8:30pmest'), { hour: 20, minute: 30, inferredEvening: false });
  assert.deepEqual(parseScheduleClock('8:30 p.m. EST'), { hour: 20, minute: 30, inferredEvening: false });
  assert.deepEqual(parseScheduleClock('tmrw 8p est'), { hour: 20, minute: 0, inferredEvening: false });
  assert.deepEqual(parseScheduleClock('Monday 8 EST'), { hour: 20, minute: 0, inferredEvening: true });
  assert.equal(parseScheduleClock('November 6 EST'), null, 'a day of the month is not a time');
  assert.equal(parseScheduleClock('11/6 EST'), null);
  assert.equal(normalizeScheduleText('11/09/2026 8:30est'), '11/09/2026 8:30 est');
  assert.equal(normalizeScheduleText('Novemeber 12th 9pm EST'), 'november 12 9pm EST');
  assert.equal(normalizeScheduleText('Thrusday 8:30 PM ET'), 'thursday 8:30 PM ET');
  assert.equal(correctDateWord('wensday'), 'wednesday');
  assert.equal(correctDateWord('Tuseday'), 'tuesday');
  assert.equal(correctDateWord('novem'), 'november');
  assert.equal(correctDateWord('next'), null);
  assert.equal(correctDateWord('game'), null);
  assert.equal(correctDateWord('est'), null);
});
