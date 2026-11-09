import test from 'node:test';
import assert from 'node:assert/strict';

import {
  teamKey,
  findTeamInfo,
  parseTeamInfoRows,
  compactMatchStats,
  teamSeason,
  groupStandings,
  whatsAtStake,
  vetoSummary,
  buildPrepPack
} from '../src/prepPack.js';

const player = (id, nickname, level = 7) => ({ player_id: id, nickname, game_skill_level: level });
const ROSTER_A = [player('a1', 'Zeph', 9), player('a2', 'Alpha'), player('a3', 'Bravo')];
const ROSTER_B = [player('b1', 'Delta'), player('b2', 'Echo')];
const ROSTER_C = [player('c1', 'Foxtrot')];

function match(id, [idA, nameA, rosterA], [idB, nameB, rosterB], { winner = null, score = null, day = 3, group = 'I', status = 'FINISHED', round = 'Group Stage - Round 1' } = {}) {
  return {
    id,
    status,
    group,
    round,
    teamA: nameA,
    teamB: nameB,
    faceitUrl: `https://www.faceit.com/en/cs2/room/${id}`,
    raw: {
      teams: {
        faction1: { faction_id: idA, name: nameA, leader: rosterA[0]?.player_id, roster: rosterA },
        faction2: { faction_id: idB, name: nameB, leader: rosterB[0]?.player_id, roster: rosterB }
      },
      results: winner ? { winner, score } : undefined,
      finished_at: Date.UTC(2026, 10, day, 3) / 1000
    }
  };
}

function stats(maps) {
  return compactMatchStats({
    rounds: maps.map(([map, [idA, scoreA, playersA], [idB, scoreB, playersB]]) => ({
      round_stats: { Map: map, Rounds: String(scoreA + scoreB) },
      teams: [
        { team_id: idA, team_stats: { Team: idA, 'Final Score': String(scoreA) }, players: playersA },
        { team_id: idB, team_stats: { Team: idB, 'Final Score': String(scoreB) }, players: playersB }
      ]
    }))
  });
}
const p = (id, nickname, kills, deaths, adr = 80, hs = 50) => ({ player_id: id, nickname, player_stats: { Kills: String(kills), Deaths: String(deaths), ADR: String(adr), 'Headshots %': String(hs) } });

const A = ['ta', 'Celestial Esports', ROSTER_A];
const B = ['tb', 'FUELED BY HATE', ROSTER_B];
const C = ['tc', 'Solar Gravity', ROSTER_C];

const seasonMatches = [
  match('m1', A, C, { winner: 'faction1', score: { faction1: 2, faction2: 0 }, day: 2 }),
  match('m2', B, C, { winner: 'faction1', score: { faction1: 2, faction2: 1 }, day: 3 }),
  match('m3', A, B, { winner: 'faction1', score: { faction1: 2, faction2: 1 }, day: 4 })
];
const statsById = new Map([
  ['m1', stats([['de_mirage', ['ta', 13, [p('a1', 'Zeph', 25, 15)]], ['tc', 5, [p('c1', 'Foxtrot', 10, 20)]]], ['de_inferno', ['ta', 13, [p('a1', 'Zeph', 20, 14)]], ['tc', 8, []]]])],
  ['m3', stats([['de_mirage', ['ta', 13, [p('a1', 'Zeph', 22, 18)]], ['tb', 9, [p('b1', 'Delta', 18, 20)]]], ['de_nuke', ['ta', 14, []], ['tb', 16, []]], ['de_ancient', ['ta', 13, []], ['tb', 11, []]]])]
]);

test('team names on the Team Info tab match FACEIT names', () => {
  assert.equal(teamKey('Celestial Esports'), teamKey('Celestial'));
  const rows = [
    [{ text: 'Name' }, { text: 'HLTV' }, { text: 'Liquipedia' }, { text: 'Pronunciation' }],
    [{ text: 'Celestial' }, { text: 'HLTV', link: 'https://www.hltv.org/team/1/celestial' }, { text: '' }, { text: 'suh-LESS-tee-ul' }],
    [{ text: 'FlyQuest Red' }, { text: 'HLTV', link: 'https://www.hltv.org/team/2/fqr' }, { text: 'Liquipedia', link: 'https://liquipedia.net/counterstrike/FQR' }, { text: '' }]
  ];
  const teams = parseTeamInfoRows(rows);
  assert.deepEqual(teams[0].links, { hltv: 'https://www.hltv.org/team/1/celestial' });
  assert.equal(teams[0].pronunciation, 'suh-LESS-tee-ul');
  assert.equal(findTeamInfo(teams, 'Celestial Esports').name, 'Celestial');
  assert.equal(findTeamInfo(teams, 'FlyQuest Red').links.liquipedia, 'https://liquipedia.net/counterstrike/FQR');
  assert.equal(findTeamInfo(teams, 'Solar Gravity'), null);
});

test('a team season: record, maps, players, streak, closest map', () => {
  const season = teamSeason({ id: 'ta', name: 'Celestial Esports' }, seasonMatches, statsById);
  assert.equal(season.wins, 2);
  assert.equal(season.losses, 0);
  assert.deepEqual(season.mapRecord, { won: 4, lost: 1 });
  assert.deepEqual(season.streak, { won: true, count: 2 });
  assert.deepEqual(season.mapPool[0], { map: 'Mirage', won: 2, lost: 0 });
  assert.equal(season.overtimes, 1);
  assert.equal(season.closest.score, '14-16');
  assert.equal(season.players[0].nickname, 'Zeph');
  assert.equal(season.players[0].kd.toFixed(2), (67 / 47).toFixed(2));
  const standings = groupStandings('I', seasonMatches, statsById);
  assert.deepEqual(standings.map((row) => [row.name, row.wins, row.losses]), [['Celestial Esports', 2, 0], ['FUELED BY HATE', 1, 1], ['Solar Gravity', 0, 2]]);
});

test("what's at stake and the veto summary", () => {
  assert.match(whatsAtStake({ round: 'Lower Bracket - Round 3' }), /eliminated/);
  assert.match(whatsAtStake({ round: 'Upper Bracket - Round 1' }), /drops to the lower bracket/);
  assert.match(whatsAtStake({ round: 'Grand Final (BO5)' }), /title/);
  assert.match(whatsAtStake({ round: 'Group Stage - Round 3', group: 'I' }), /Group I/);
  const veto = {
    status: 'complete', teamA: 'A', teamB: 'B',
    actions: [{ team: 'teamA', action: 'ban', map: 'de_nuke' }, { team: 'teamB', action: 'ban', map: 'de_train' }, { team: 'teamA', action: 'pick', map: 'de_mirage' }, { team: 'teamB', action: 'pick', map: 'de_inferno' }],
    final: { playableMaps: ['de_mirage', 'de_inferno', 'de_ancient'], decider: 'de_ancient' }
  };
  const summary = vetoSummary({ veto });
  assert.deepEqual(summary.maps.map((entry) => `${entry.map}:${entry.note}`), ['Mirage:A pick', 'Inferno:B pick', 'Ancient:decider']);
  assert.deepEqual(summary.bans, ['Nuke (A)', 'Train (B)']);
  assert.deepEqual(vetoSummary({ match: { raw: { voting: { map: { pick: ['de_dust2'] } } } } }).maps, [{ map: 'Dust2', note: null }]);
});

test('the whole pack: three cards, talking points, stand-ins, team notes', () => {
  const tonight = match('m4', ['ta', 'Celestial Esports', [...ROSTER_A, player('a9', 'Ringer', 5)]], B, { status: 'READY', day: 9, round: 'Group Stage - Round 3' });
  const pack = buildPrepPack({
    match: tonight,
    seasonMatches,
    statsById,
    teamInfo: parseTeamInfoRows([[{ text: 'Name' }, { text: 'HLTV' }, { text: 'Pronunciation' }], [{ text: 'Celestial' }, { text: 'HLTV', link: 'https://hltv.org/x' }, { text: 'suh-LESS' }]]),
    streamHistory: [{ matchId: 'm1', startMs: Date.UTC(2026, 10, 2, 2) }],
    startIso: '2026-11-10T02:30:00Z',
    seasonName: 'Season 7',
    streamUrl: 'https://twitch.tv/playcrossfire',
    now: Date.UTC(2026, 10, 10)
  });
  assert.equal(pack.embeds.length, 3);
  assert.match(pack.talkingPoints.join(' '), /Rematch: Celestial Esports won their last meeting 2-1/);
  assert.match(pack.talkingPoints.join(' '), /Celestial Esports is unbeaten this season \(2-0\)/);
  assert.match(pack.talkingPoints.join(' '), /Celestial Esports has a stand-in: Ringer/);
  const teamCard = pack.embeds[1];
  assert.doesNotMatch(teamCard.description, /Say it/);
  assert.equal(pack.notes.length, 1, 'only the team with notes gets a notes reply');
  assert.match(pack.notes[0].description, /Say it: \*\*suh-LESS\*\*/);
  assert.match(teamCard.description, /\[HLTV\]\(https:\/\/hltv\.org\/x\)/);
  assert.doesNotMatch(teamCard.description, /Last on the main stream/);
  assert.equal(teamCard.description, '🔗 [FACEIT](https://www.faceit.com/en/teams/ta) · [HLTV](https://hltv.org/x)');
  assert.match(teamCard.fields.find((field) => field.name === 'Season 7').value, /✅ \[2-1 vs FUELED BY HATE\]\(https:\/\/www\.faceit\.com\/en\/cs2\/room\/m3\)/);
  assert.match(pack.embeds[0].fields.find((field) => field.name === 'H2H').value, /^\[Celestial Esports won 2-1\]\(https:\/\/www\.faceit\.com\/en\/cs2\/room\/m3\)/);
  assert.match(teamCard.fields.find((field) => field.name === 'Roster').value, /^👑 Zeph$/m);
  assert.match(teamCard.fields.find((field) => field.name === 'Roster').value, /^Ringer · stand-in$/m);
  assert.doesNotMatch(teamCard.fields.find((field) => field.name === 'Roster').value, /lvl/);
  assert.match(teamCard.fields.find((field) => field.name === 'Record').value, /1st in Group I \(2-0\)/);
  assert.match(pack.embeds[0].fields.find((field) => field.name === '🗺️ Maps').value, /Veto not done yet/);
  assert.ok(pack.signature.includes('a9'));
});

test('locked maps get a block each: picker, records, last result, best player there, head-to-head', () => {
  const tonight = match('m5', A, B, { status: 'READY', day: 9 });
  const veto = {
    status: 'complete', teamA: 'Celestial Esports', teamB: 'FUELED BY HATE',
    actions: [
      { team: 'teamA', action: 'ban', map: 'de_train' }, { team: 'teamB', action: 'ban', map: 'de_vertigo' },
      { team: 'teamA', action: 'pick', map: 'de_mirage' }, { team: 'teamB', action: 'pick', map: 'de_dust2' }
    ],
    final: { playableMaps: ['de_mirage', 'de_dust2', 'de_nuke'], decider: 'de_nuke' }
  };
  const pack = buildPrepPack({ match: tonight, seasonMatches, statsById, veto, now: Date.UTC(2026, 10, 10) });
  const summary = pack.embeds[0].fields.find((field) => field.name === '🗺️ Maps locked').value;
  assert.equal(summary, '**1. Mirage** · Celestial Esports pick\n**2. Dust2** · FUELED BY HATE pick\n**3. Nuke** · decider\nBans: Train (Celestial Esports) · Vertigo (FUELED BY HATE)');
  assert.equal(pack.embeds.length, 3, 'match and two teams; map facts are their own reply');
  assert.equal(pack.mapFacts.title, '🗺️ Map facts');
  const fields = pack.mapFacts.fields;
  const mirage = fields.find((field) => field.name === 'Map 1 · Mirage (Celestial Esports pick)').value;
  assert.match(mirage, /\*\*Celestial Esports\*\* 2-0 · last: \[W 13-9 vs FUELED BY HATE\]\(https:\/\/www\.faceit\.com\/en\/cs2\/room\/m3\) · ⭐ Zeph 1\.42 K\/D, 80 ADR here/);
  assert.match(mirage, /\*\*FUELED BY HATE\*\* 0-1 · last: \[L 9-13 vs Celestial Esports\]/);
  assert.match(mirage, /H2H here: \[Celestial Esports won 13-9\]/);
  assert.match(fields.find((field) => field.name === 'Map 2 · Dust2 (FUELED BY HATE pick)').value, /first time on Dust2 this season/);
  assert.match(fields.find((field) => field.name === 'Map 3 · Nuke (decider)').value, /\*\*FUELED BY HATE\*\* 1-0/);
  assert.deepEqual(pack.maps, ['Mirage', 'Dust2', 'Nuke']);
});

test('a veto in progress lists each ban and pick as it happens', () => {
  const tonight = match('m6', A, B, { status: 'READY', day: 9 });
  const veto = { status: 'active', teamA: 'Celestial Esports', teamB: 'FUELED BY HATE', actions: [{ team: 'teamA', action: 'ban', map: 'de_train' }, { team: 'teamB', action: 'ban', map: 'de_vertigo' }, { team: 'teamA', action: 'pick', map: 'de_mirage' }] };
  const pack = buildPrepPack({ match: tonight, seasonMatches, statsById, veto });
  assert.equal(pack.embeds[0].fields.find((field) => field.name === '🗺️ Maps').value, 'Ban: Train (Celestial Esports)\nBan: Vertigo (FUELED BY HATE)\nPick: Mirage (Celestial Esports)\nVeto in progress…');
  assert.equal(pack.mapFacts, null, 'no map facts until the maps are locked');
  const later = buildPrepPack({ match: tonight, seasonMatches, statsById, veto: { ...veto, actions: [...veto.actions, { team: 'teamB', action: 'pick', map: 'de_dust2' }] } });
  assert.notEqual(later.signature, pack.signature, 'each step changes the post');
});

test('team card headings: Record, the season name for results, Map pool', () => {
  const tonight = match('m7', A, B, { status: 'READY', day: 9 });
  const pack = buildPrepPack({ match: tonight, seasonMatches, statsById, seasonName: 'Season 7' });
  const names = pack.embeds[1].fields.map((field) => field.name);
  assert.deepEqual(names, ['Roster', 'Record', 'Season 7', 'Map pool', 'Top players']);
});

test('record shows the round differential; top players show kills and deaths first', () => {
  const tonight = match('m8', A, B, { status: 'READY', day: 9 });
  const pack = buildPrepPack({ match: tonight, seasonMatches, statsById });
  const record = pack.embeds[1].fields.find((field) => field.name === 'Record').value;
  // Celestial: m1 13-5, 13-8; m3 13-9, 14-16, 13-11 -> 66 won, 49 lost
  assert.match(record, /Round diff: \*\*\+17\*\* \(66 won, 49 lost\)/);
  assert.match(record, /1st in Group I \(2-0\)/);
  assert.match(pack.embeds[1].fields.find((field) => field.name === 'Top players').value, /^⭐ Zeph: 67 K · 47 D · 1\.43 K\/D · /);
  assert.ok(pack.embeds[0].fields.some((field) => field.name === 'H2H'));
});
