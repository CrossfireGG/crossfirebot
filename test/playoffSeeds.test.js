import assert from 'node:assert/strict';
import test from 'node:test';

import { derivePlayoffSeedMap, standardBracketSeedOrder } from '../src/playoffSeeds.js';

test('builds the standard 32-team bracket seed order', () => {
  assert.deepEqual(standardBracketSeedOrder(32), [
    1, 32, 16, 17, 8, 25, 9, 24,
    4, 29, 13, 20, 5, 28, 12, 21,
    2, 31, 15, 18, 7, 26, 10, 23,
    3, 30, 14, 19, 6, 27, 11, 22
  ]);
});

test('derives original seeds from FACEIT top-to-bottom first-round bracket order', () => {
  const matches = [
    { teamA: 'Bottom A', teamB: 'Bottom B', round: 'Upper Bracket - Round 1', bracketOrder: -1 },
    { teamA: 'Top A', teamB: 'Top B', round: 'Upper Bracket - Round 1', bracketOrder: -2 }
  ];
  const seeds = derivePlayoffSeedMap(matches);

  assert.equal(seeds.get('top a'), 1);
  assert.equal(seeds.get('top b'), 4);
  assert.equal(seeds.get('bottom a'), 2);
  assert.equal(seeds.get('bottom b'), 3);
});

test('ignores later playoff rounds when deriving seeds', () => {
  const seeds = derivePlayoffSeedMap([
    { teamA: 'Seed One', teamB: 'Seed Four', round: 'Upper Bracket - Round 1', bracketOrder: 0 },
    { teamA: 'Later Winner', teamB: 'Other Winner', round: 'Upper Bracket - Round 2', bracketOrder: 0 }
  ]);

  assert.equal(seeds.size, 2);
  assert.equal(seeds.get('seed one'), 1);
  assert.equal(seeds.has('later winner'), false);
});
