import assert from 'node:assert/strict';
import test from 'node:test';

import { FaceitClient } from '../src/faceit.js';

test('extracts FACEIT match scores from direct score fields', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    match_id: 'match-1',
    status: 'FINISHED',
    teams: {
      faction1: { name: 'Team One' },
      faction2: { name: 'Team Two' }
    },
    results: {
      score: {
        faction1: 2,
        faction2: 1
      }
    }
  }), { status: 200 }));

  const match = await new FaceitClient('api-key', []).getMatch('match-1');
  assert.equal(match.teamAScore, 2);
  assert.equal(match.teamBScore, 1);
  assert.equal(match.resultScore, '2-1');
});

test('extracts FACEIT match scores from map wins', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    match_id: 'match-1',
    status: 'FINISHED',
    teams: {
      faction1: { name: 'Team One' },
      faction2: { name: 'Team Two' }
    },
    results: {
      maps: [
        { faction1_score: 13, faction2_score: 8 },
        { faction1_score: 10, faction2_score: 13 },
        { faction1_score: 13, faction2_score: 11 }
      ]
    }
  }), { status: 200 }));

  const match = await new FaceitClient('api-key', []).getMatch('match-1');
  assert.equal(match.teamAScore, 2);
  assert.equal(match.teamBScore, 1);
  assert.equal(match.resultScore, '2-1');
});
