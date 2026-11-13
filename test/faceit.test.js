import assert from 'node:assert/strict';
import test from 'node:test';

import { FaceitClient } from '../src/faceit.js';

test('restores top-to-bottom order for playoff rounds returned bottom-to-top', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    items: [
      {
        match_id: 'bottom-match',
        round: 1,
        group: 1,
        teams: {
          faction1: { name: 'Bottom Team One' },
          faction2: { name: 'Bottom Team Two' }
        }
      },
      {
        match_id: 'top-match',
        round: 1,
        group: 1,
        teams: {
          faction1: { name: 'Top Team One' },
          faction2: { name: 'Top Team Two' }
        }
      }
    ]
  }), { status: 200 }));

  const matches = await new FaceitClient('api-key', [{
    type: 'championship',
    id: 'playoffs',
    name: 'CROSSFIRE Season 7 - Playoffs'
  }]).getMatches();

  assert.equal(matches[0].bracketOrder, 0);
  assert.equal(matches[1].bracketOrder, -1);
  assert.deepEqual(
    [...matches].sort((left, right) => left.bracketOrder - right.bracketOrder).map((match) => match.id),
    ['top-match', 'bottom-match']
  );
});

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

test('reads Season 7 group-stage rounds and groups from FACEIT', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    match_id: 'season-7-match',
    status: 'SCHEDULED',
    round_number: 4,
    group_name: 'Group J',
    teams: {
      faction1: { name: 'Team One' },
      faction2: { name: 'Team Two' }
    }
  }), { status: 200 }));

  const match = await new FaceitClient('api-key', []).getMatch('season-7-match', {
    type: 'championship',
    id: 'db2dfb5f-0569-40bd-b489-84bb759e72ed',
    name: 'Crossfire Season 7 - Group Stage'
  });

  assert.equal(match.categoryName, 'Group Stage - Round 4');
  assert.equal(match.round, 'Group Stage - Round 4');
  assert.equal(match.group, 'Group J');
});

test('keeps winners bracket playoff round names distinct', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    match_id: 'match-1',
    status: 'SCHEDULED',
    round: 1,
    round_name: 'Round of 16',
    bracket_name: 'Winners Bracket',
    teams: {
      faction1: { name: 'Team One' },
      faction2: { name: 'Team Two' }
    }
  }), { status: 200 }));

  const match = await new FaceitClient('api-key', []).getMatch('match-1', {
    type: 'championship',
    id: 'playoffs',
    name: 'CROSSFIRE Season 6 - Playoffs'
  });

  assert.equal(match.categoryName, 'Upper Bracket - Round 1');
  assert.equal(match.round, 'Upper Bracket - Round 1');
});

test('keeps losers bracket playoff round names distinct', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    match_id: 'match-1',
    status: 'SCHEDULED',
    round_name: 'Lower Round 2',
    bracket_name: 'Lower Bracket',
    teams: {
      faction1: { name: 'Team One' },
      faction2: { name: 'Team Two' }
    }
  }), { status: 200 }));

  const match = await new FaceitClient('api-key', []).getMatch('match-1', {
    type: 'championship',
    id: 'playoffs',
    name: 'CROSSFIRE Season 6 - Playoffs'
  });

  assert.equal(match.categoryName, 'Lower Bracket - Round 2');
  assert.equal(match.round, 'Lower Bracket - Round 2');
});

test('combines separate playoff bracket side and round fields', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    match_id: 'match-1',
    status: 'SCHEDULED',
    round_name: 'Round 2',
    bracket_name: 'Upper Bracket',
    teams: {
      faction1: { name: 'Team One' },
      faction2: { name: 'Team Two' }
    }
  }), { status: 200 }));

  const match = await new FaceitClient('api-key', []).getMatch('match-1', {
    type: 'championship',
    id: 'playoffs',
    name: 'CROSSFIRE Season 6 - Playoffs'
  });

  assert.equal(match.categoryName, 'Upper Bracket - Round 2');
  assert.equal(match.round, 'Upper Bracket - Round 2');
});

test('uses lower bracket round 8 instead of lower bracket final', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    match_id: 'match-1',
    status: 'SCHEDULED',
    round: 8,
    bracket_name: 'Lower Bracket',
    teams: {
      faction1: { name: 'Team One' },
      faction2: { name: 'Team Two' }
    }
  }), { status: 200 }));

  const match = await new FaceitClient('api-key', []).getMatch('match-1', {
    type: 'championship',
    id: 'playoffs',
    name: 'CROSSFIRE Season 6 - Playoffs'
  });

  assert.equal(match.categoryName, 'Lower Bracket - Round 8');
  assert.equal(match.round, 'Lower Bracket - Round 8');
});

test('uses scheduled playoff window when bracket side is missing', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    match_id: 'match-1',
    status: 'SCHEDULED',
    round: 1,
    scheduled_at: 1789593600,
    teams: {
      faction1: { name: 'Celestial Esports' },
      faction2: { name: 'Omen Esports' }
    }
  }), { status: 200 }));

  const match = await new FaceitClient('api-key', []).getMatch('match-1', {
    type: 'championship',
    id: 'playoffs',
    name: 'CROSSFIRE Season 6 - Playoffs'
  });

  assert.equal(match.categoryName, 'Lower Bracket - Round 1');
  assert.equal(match.round, 'Lower Bracket - Round 1');
});

test('defaults ambiguous playoff round 4 to lower bracket when bracket side is missing', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    match_id: 'match-1',
    status: 'SCHEDULED',
    round: 4,
    scheduled_at: 1790380800,
    teams: {
      faction1: { name: 'Villainous' },
      faction2: { name: 'Zomblers' }
    }
  }), { status: 200 }));

  const match = await new FaceitClient('api-key', []).getMatch('match-1', {
    type: 'championship',
    id: 'playoffs',
    name: 'CROSSFIRE Season 6 - Playoffs'
  });

  assert.equal(match.categoryName, 'Lower Bracket - Round 4');
  assert.equal(match.round, 'Lower Bracket - Round 4');
});

test('uses FACEIT group 2 for lower bracket round 5 before schedule fallback', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    match_id: '1-85bb66d7-0087-453b-b92d-2b6a123d2f84',
    status: 'SCHEDULED',
    round: 5,
    group: 2,
    teams: {
      faction1: { name: 'LAG Gaming' },
      faction2: { name: 'Villainous' }
    }
  }), { status: 200 }));

  const match = await new FaceitClient('api-key', []).getMatch('1-85bb66d7-0087-453b-b92d-2b6a123d2f84', {
    type: 'championship',
    id: 'playoffs',
    name: 'CROSSFIRE Season 6 - Playoffs'
  });

  assert.equal(match.categoryName, 'Lower Bracket - Round 5');
  assert.equal(match.round, 'Lower Bracket - Round 5');
});

test('uses FACEIT group 1 for upper bracket when schedule windows overlap', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    match_id: 'upper-round-4',
    status: 'SCHEDULED',
    round: 4,
    group: 1,
    scheduled_at: 1790380800,
    teams: {
      faction1: { name: 'Marsborne' },
      faction2: { name: 'regain' }
    }
  }), { status: 200 }));

  const match = await new FaceitClient('api-key', []).getMatch('upper-round-4', {
    type: 'championship',
    id: 'playoffs',
    name: 'CROSSFIRE Season 6 - Playoffs'
  });

  assert.equal(match.categoryName, 'Upper Bracket - Round 4');
  assert.equal(match.round, 'Upper Bracket - Round 4');
});
