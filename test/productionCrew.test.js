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

test('the #request-ip post pings the main stream crew, and a later crew gets a link to it', async () => {
  const { buildRequestIpMessage, buildCrewIpPing } = await import('../src/streamRequest.js');
  const post = buildRequestIpMessage({ matchup: 'A vs B', value: 'connect 1.2.3.4:27015', mainStream: true, crewIds: ['11', '33'] });
  assert.match(post, /^📺 \*\*MAIN STREAM: A vs B\*\*/);
  assert.match(post, /\nCrew: <@11> <@33>$/);
  assert.doesNotMatch(buildRequestIpMessage({ matchup: 'A vs B', value: 'x', mainStream: true }), /Crew:/);
  assert.equal(
    buildCrewIpPing({ matchup: 'A vs B', ipMessageUrl: 'https://discord.com/channels/1/2/3', crewIds: ['11', '33'] }),
    "🎬 <@11> <@33>: you're on the crew for **A vs B**. The connection details are here: https://discord.com/channels/1/2/3."
  );
  assert.equal(buildCrewIpPing({ matchup: 'A vs B', crewIds: [] }), null);
});

test('main stream sheet row carries the picked Twitch link and the main stream highlight', async () => {
  const { buildMainStreamSheetRow, buildStreamLinkSheetRow } = await import('../src/scheduleSheet.js');
  const row = buildMainStreamSheetRow(
    { matchId: '1-abc', matchup: 'Celestial Esports vs FUELED BY HATE', faceitUrl: 'https://www.faceit.com/en/cs2/room/1-abc' },
    { streamUrl: 'https://twitch.tv/playcrossfirecs', actorId: '9' }
  );
  assert.equal(row.faceitLink, 'https://www.faceit.com/en/cs2/room/1-abc');
  assert.equal(row.streamUrl, 'https://twitch.tv/playcrossfirecs');
  assert.deepEqual([row.team1, row.team2], ['Celestial Esports', 'FUELED BY HATE']);
  assert.equal(row.highlight, 'main');
  assert.equal(buildStreamLinkSheetRow({ matchup: 'A vs B', streamUrl: 'x' }, { highlight: 'community' }).highlight, 'community');
  assert.equal(buildStreamLinkSheetRow({ matchup: 'A vs B', streamUrl: 'x' }).highlight, '');
});

test('crew options only change the roles given', async () => {
  const { mergeCrewOptions, buildMainStreamCancelledNotice } = await import('../src/streamRequest.js');
  const crew = { casters: ['11', '22'], producer: '33', observer: '44', admin: null, social: null };
  assert.deepEqual(mergeCrewOptions(crew, { producer: '99' }), { casters: ['11', '22'], producer: '99', observer: '44', admin: null, social: null });
  assert.deepEqual(mergeCrewOptions(crew, { caster2: '55' }).casters, ['11', '55']);
  assert.deepEqual(mergeCrewOptions({}, { caster1: '11', producer: '33' }), { casters: ['11'], producer: '33', observer: null, admin: null, social: null });
  assert.deepEqual(mergeCrewOptions({}, { caster1: '11', caster2: '11' }).casters, ['11'], 'the same person is not both casters');
  const notice = buildMainStreamCancelledNotice({ matchup: 'A vs B', communityCasters: 1 });
  assert.equal(notice.title, '🚫 No longer on the main stream');
  assert.match(notice.fields[0].value, /1 community caster/);
});
