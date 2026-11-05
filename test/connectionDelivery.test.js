import test from 'node:test';
import assert from 'node:assert/strict';

import { buildConnectionDm, requestRoomId, selectConnectionRecipients } from '../src/streamRequest.js';

const ROOM = '1-6b80a3ed-d6a7-4acf-905e-4318aa8774fe';
const LINK = `https://www.faceit.com/en/cs2/room/${ROOM}`;

test('both approved casters on one match get the IP', () => {
  const { recipients } = selectConnectionRecipients([
    { id: 'a', requesterId: 'spawned', status: 'approved', matchId: ROOM, faceitUrl: LINK },
    { id: 'b', requesterId: 'floofy', status: 'approved', matchId: ROOM, faceitUrl: LINK }
  ], ROOM);
  assert.deepEqual(recipients.map((request) => request.requesterId).sort(), ['floofy', 'spawned']);
});

test('a caster whose FACEIT link was not verified at submit time is still included', () => {
  const { recipients } = selectConnectionRecipients([
    { id: 'a', requesterId: 'spawned', status: 'approved', matchId: ROOM, faceitUrl: LINK },
    { id: 'b', requesterId: 'floofy', status: 'approved', matchId: null, faceitUrl: `https://www.faceit.com/en/cs2/room/${ROOM.toUpperCase()}/scoreboard` }
  ], ROOM);
  assert.deepEqual(recipients.map((request) => request.requesterId).sort(), ['floofy', 'spawned']);
});

test('a caster whose website publish failed is still included; pending, denied and withdrawn are not', () => {
  const { recipients } = selectConnectionRecipients([
    { id: 'a', requesterId: 'one', status: 'publish_failed', matchId: ROOM },
    { id: 'b', requesterId: 'two', status: 'pending', matchId: ROOM },
    { id: 'c', requesterId: 'three', status: 'denied', matchId: ROOM },
    { id: 'd', requesterId: 'four', status: 'withdrawn', matchId: ROOM },
    { id: 'e', requesterId: 'five', status: 'approved', matchId: '1-00000000-0000-0000-0000-000000000000' }
  ], ROOM);
  assert.deepEqual(recipients.map((request) => request.requesterId), ['one']);
});

test('one DM per caster even with two requests for the same match', () => {
  const { recipients, requests } = selectConnectionRecipients([
    { id: 'a', requesterId: 'floofy', status: 'publish_failed', matchId: ROOM },
    { id: 'b', requesterId: 'floofy', status: 'approved', matchId: ROOM }
  ], ROOM);
  assert.equal(requests.length, 2);
  assert.deepEqual(recipients.map((request) => request.id), ['b']);
});

test('requestRoomId falls back to the submitted link', () => {
  assert.equal(requestRoomId({ matchId: null, faceitUrl: LINK }), ROOM);
  assert.equal(requestRoomId({ matchId: null, faceitUrl: 'not a link' }), null);
});

test('connection DM wording is unchanged', () => {
  assert.equal(buildConnectionDm({ matchup: 'A vs B', type: 'cstv', value: 'connect 1.2.3.4:27020' }), '**A vs B** is ready. FACEIT CSTV connect:\n`connect 1.2.3.4:27020`');
  assert.equal(buildConnectionDm({ matchup: 'A vs B', type: 'custom', value: 'pw x' }), '**A vs B** is ready. connection details from Tournament Operations:\npw x');
});
