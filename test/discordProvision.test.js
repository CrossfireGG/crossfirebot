import assert from 'node:assert/strict';
import test from 'node:test';

import { makeMatchChannelName } from '../src/matchChannelName.js';
import { updateMatchChannelName } from '../src/discordProvision.js';

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

test('unscheduled FACEIT matches have no status prefix even when scheduled_at is populated', () => {
  assert.equal(
    makeMatchChannelName({ ...baseMatch, status: 'unknown', scheduledAt: 'Sep 1, 2026' }),
    'a-team-one-vs-team-two'
  );
});

test('generic FACEIT SCHEDULED status does not add yellow without a confirmed Discord schedule', () => {
  assert.equal(
    makeMatchChannelName({ ...baseMatch, status: 'SCHEDULED', scheduledAt: 'Sep 1, 2026' }),
    'a-team-one-vs-team-two'
  );
});

test('matches scheduled through Discord use the yellow status prefix', () => {
  assert.equal(
    makeMatchChannelName({ ...baseMatch, status: 'discord_scheduled', scheduledByDiscord: true }),
    '🟡-a-team-one-vs-team-two'
  );
});

test('matches with SCL demo links use the green status prefix', () => {
  assert.equal(
    makeMatchChannelName({ ...baseMatch, status: 'scl_demo_ready' }),
    '🟢-a-team-one-vs-team-two'
  );
});

test('channel rename helper returns the updated channel name', async () => {
  const channel = {
    id: 'channel-1',
    name: 'a-team-one-vs-team-two',
    async setName(name) {
      this.name = name;
      return this;
    }
  };

  const result = await updateMatchChannelName(channel, {
    ...baseMatch,
    status: 'discord_scheduled',
    scheduledByDiscord: true
  });

  assert.equal(result.changed, true);
  assert.equal(result.name, '🟡-a-team-one-vs-team-two');
  assert.equal(channel.name, '🟡-a-team-one-vs-team-two');
});
