import assert from 'node:assert/strict';
import test from 'node:test';

import { makeMatchChannelName } from '../src/matchChannelName.js';

const baseMatch = {
  teamA: 'Team One',
  teamB: 'Team Two',
  group: 'Group A'
};

test('finished FACEIT matches use the green status prefix', () => {
  assert.equal(
    makeMatchChannelName({ ...baseMatch, status: 'FINISHED', scheduledAt: 'Sep 1, 2026' }),
    '🟢-a-team-one-vs-team-two'
  );
});

test('scheduled FACEIT matches use the yellow status prefix', () => {
  assert.equal(
    makeMatchChannelName({ ...baseMatch, status: 'SCHEDULED', scheduledAt: 'Sep 1, 2026' }),
    '🟡-a-team-one-vs-team-two'
  );
});

test('unscheduled FACEIT matches have no status prefix', () => {
  assert.equal(
    makeMatchChannelName({ ...baseMatch, status: 'unknown', scheduledAt: null }),
    'a-team-one-vs-team-two'
  );
});
