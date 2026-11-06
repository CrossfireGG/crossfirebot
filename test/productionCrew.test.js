import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMainStreamSchedulePost, crewUserIds, PRODUCTION_CREW_FIELDS } from '../src/streamRequest.js';

test('the crew form asks for Casters (1-2) and Producer as required, the rest optional', () => {
  assert.deepEqual(PRODUCTION_CREW_FIELDS.map((field) => [field.label, field.required, field.max]), [
    ['Casters', true, 2],
    ['Producer', true, 1],
    ['Observer', false, 1],
    ['Admin', false, 1],
    ['Social Media', false, 1]
  ]);
});

test('the schedule post matches the format staff already use, with local-time timestamps', () => {
  const post = buildMainStreamSchedulePost({
    teamA: 'Celestial Esports',
    teamB: 'FUELED BY HATE',
    faceitUrl: 'https://www.faceit.com/en/cs2/room/1-a5d88e7b-39ae-4a0e-b599-a6560d5541ee',
    // 9:30 PM Eastern on Thursday, November 5, 2026 (EST, UTC-5).
    scheduleIso: '2026-11-06T02:30:00Z',
    crew: { casters: ['11', '22'], producer: '33', observer: '44', admin: null, social: null },
    streamUrl: 'https://twitch.tv/playcrossfire'
  });
  assert.equal(post, [
    '<t:1793932200:D>',
    '<t:1793932200:t>',
    '',
    'Celestial Esports    VS    FUELED BY HATE',
    '',
    'https://www.faceit.com/en/cs2/room/1-a5d88e7b-39ae-4a0e-b599-a6560d5541ee',
    '',
    'Casters: <@11> & <@22>',
    '',
    'Prod: <@33>',
    'Obs: <@44>',
    '',
    'Streams: https://twitch.tv/playcrossfire'
  ].join('\n'));
});

test('one caster, every optional role, no time and team names from the matchup', () => {
  const post = buildMainStreamSchedulePost({
    matchup: 'Wolves vs Ravens',
    crew: { casters: ['11'], producer: '33', observer: '44', admin: '55', social: '66' }
  });
  assert.equal(post, [
    'Date and time TBD',
    '',
    'Wolves    VS    Ravens',
    '',
    'Caster: <@11>',
    '',
    'Prod: <@33>',
    'Obs: <@44>',
    'Admin: <@55>',
    'Social: <@66>'
  ].join('\n'));
});

test('the post pings exactly the crew, once each', () => {
  assert.deepEqual(crewUserIds({ casters: ['11', '22'], producer: '11', observer: null, admin: '55', social: undefined }), ['11', '22', '55']);
});
