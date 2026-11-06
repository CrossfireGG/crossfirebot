import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMatchResult, prettyMapName } from '../src/matchResult.js';

function match({ winner = 'faction1', a = 1, b = 0 } = {}) {
  return {
    teamA: 'Celestial Esports',
    teamB: 'FUELED BY HATE',
    teamAScore: a,
    teamBScore: b,
    raw: {
      teams: { faction1: { faction_id: 'f1' }, faction2: { faction_id: 'f2' } },
      results: { winner, score: { faction1: a, faction2: b } }
    }
  };
}

function round(map, f1, f2, { swap = false } = {}) {
  const teams = [
    { team_id: 'f1', team_stats: { Team: 'Celestial Esports', 'Final Score': String(f1) } },
    { team_id: 'f2', team_stats: { Team: 'FUELED BY HATE', 'Final Score': String(f2) } }
  ];
  return { round_stats: { Map: map }, teams: swap ? teams.reverse() : teams };
}

test('map names read like the map pool', () => {
  assert.equal(prettyMapName('de_mirage'), 'Mirage');
  assert.equal(prettyMapName('de_ancient_night'), 'Ancient Night');
  assert.equal(prettyMapName(''), '');
});

test('a BO1 shows the round score and map, winner first', () => {
  assert.equal(buildMatchResult(match(), { rounds: [round('de_mirage', 13, 7)] }).text, 'Celestial Esports won 13-7 (Mirage)');
  const upset = buildMatchResult(match({ winner: 'faction2', a: 0, b: 1 }), { rounds: [round('de_nuke', 9, 13, { swap: true })] });
  assert.equal(upset.text, 'FUELED BY HATE won 13-9 (Nuke)');
});

test('a BO3 shows the series score and each map, winner first', () => {
  const result = buildMatchResult(match({ a: 2, b: 1 }), {
    rounds: [round('de_mirage', 13, 7), round('de_inferno', 10, 13), round('de_nuke', 13, 11)]
  });
  assert.equal(result.text, 'Celestial Esports won 2-1 (Mirage 13-7, Inferno 10-13, Nuke 13-11)');
  assert.deepEqual([result.winner, result.teamAScore, result.teamBScore], ['Celestial Esports', 2, 1]);
});

test('without map stats (e.g. a forfeit) it falls back to the FACEIT score, and no winner means no result', () => {
  assert.equal(buildMatchResult(match(), null).text, 'Celestial Esports won 1-0');
  assert.equal(buildMatchResult({ ...match(), teamAScore: null, teamBScore: null }, null).text, 'Celestial Esports won');
  assert.equal(buildMatchResult({ ...match({ winner: null, a: null, b: null }), raw: { results: {} } }, null), null);
});
