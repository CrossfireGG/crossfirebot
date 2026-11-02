import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScheduleClock } from '../src/scheduleInput.js';

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
