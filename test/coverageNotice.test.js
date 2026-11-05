import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMainStreamCoverageNotice } from '../src/streamRequest.js';

test('the main stream notice tells the teams the official stream is casting them', () => {
  const notice = buildMainStreamCoverageNotice({
    matchup: 'Wolves vs Ravens',
    faceitUrl: 'https://www.faceit.com/en/cs2/room/1-abc',
    scheduleIso: '2026-11-06T01:00:00Z',
    streamUrl: 'https://twitch.tv/crossfirecs'
  });
  assert.equal(notice.title, '📺 This match will be on the main stream!');
  assert.equal(notice.description, '**Wolves vs Ravens** will be casted live by **crossfirecs**');
  assert.deepEqual(notice.fields.map((field) => field.name), ['When', 'Watch', 'FACEIT Matchroom']);
  assert.match(notice.fields[0].value, /<t:\d+:F>/);
  assert.equal(notice.fields[1].value, 'https://twitch.tv/crossfirecs');
});

test('without a stream link or time it names the official stream and says the time is to be confirmed', () => {
  const notice = buildMainStreamCoverageNotice({ matchup: 'Wolves vs Ravens' });
  assert.equal(notice.description, '**Wolves vs Ravens** will be casted live by **the official CROSSFIRE stream**');
  assert.deepEqual(notice.fields, [{ name: 'When', value: 'Time to be confirmed', inline: false }]);
});
