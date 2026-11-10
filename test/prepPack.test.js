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
  faceitVetoUnderway,
  compactFaceitVeto,
  compactBotVeto,
  teamBanRates,
  vetoOrderLines,
  groupStakes,
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

// FACEIT's veto history for a real Season 7 match (FUELED BY HATE vs Solar Gravity), shortened.
const vetoHistory = (picks = ['de_nuke', 'de_anubis', 'de_ancient']) => ({
  match_id: 'mv',
  tickets: [
    { entity_type: 'location', vote_type: 'drop_pick', entities: [{ guid: 'Chicago', status: 'pick', round: 3, selected_by: 'faction2' }] },
    {
      entity_type: 'map',
      vote_type: 'drop_pick',
      entities: [
        { guid: 'de_mirage', status: 'drop', random: false, round: 1, selected_by: 'faction1' },
        { guid: 'de_dust2', status: 'drop', random: false, round: 2, selected_by: 'faction2' },
        { guid: picks[0], status: 'pick', random: false, round: 3, selected_by: 'faction1' },
        { guid: picks[1], status: 'pick', random: true, round: 4, selected_by: 'faction2' },
        { guid: 'de_inferno', status: 'drop', random: false, round: 5, selected_by: 'faction1' },
        { guid: 'de_cache', status: 'drop', random: false, round: 6, selected_by: 'faction2' },
        { guid: picks[2], status: 'pick', random: false, round: 7, selected_by: 'faction1' }
      ]
    }
  ]
});

test('a FACEIT veto shows who picked each map, the decider and the bans', () => {
  const room = match('mv', B, C, { status: 'READY' });
  room.raw.voting = { map: { pick: ['de_nuke', 'de_anubis', 'de_ancient'] } };
  const faceitVeto = compactFaceitVeto(vetoHistory(), room);
  assert.deepEqual(faceitVeto.actions.map((action) => `${action.action}:${action.map}:${action.teamName}`), [
    'ban:de_mirage:FUELED BY HATE', 'ban:de_dust2:Solar Gravity', 'pick:de_nuke:FUELED BY HATE', 'pick:de_anubis:Solar Gravity',
    'ban:de_inferno:FUELED BY HATE', 'ban:de_cache:Solar Gravity', 'decider:de_ancient:null'
  ]);
  const summary = vetoSummary({ match: room, faceitVeto });
  assert.deepEqual(summary.maps.map((entry) => `${entry.map}:${entry.note}`), ['Nuke:FUELED BY HATE pick', 'Anubis:Solar Gravity pick (random)', 'Ancient:decider']);
  assert.deepEqual(summary.bans, ['Mirage (FUELED BY HATE)', 'Dust2 (Solar Gravity)', 'Inferno (FUELED BY HATE)', 'Cache (Solar Gravity)']);
  // Ban, ban, pick, pick, ban, ban, left-over decider: in that order.
  assert.deepEqual(vetoOrderLines(summary), [
    'Mirage · FUELED BY HATE ban',
    'Dust2 · Solar Gravity ban',
    '**Nuke** · FUELED BY HATE pick → Map 1',
    '**Anubis** · Solar Gravity pick (random) → Map 2',
    'Inferno · FUELED BY HATE ban',
    'Cache · Solar Gravity ban',
    '**Ancient** · decider (left over) → Map 3'
  ]);
  // A veto history that disagrees with FACEIT's final maps is ignored.
  const stale = vetoSummary({ match: room, faceitVeto: compactFaceitVeto(vetoHistory(['de_train', 'de_anubis', 'de_ancient']), room) });
  assert.deepEqual(stale.maps.map((entry) => entry.note), [null, null, null]);
  assert.deepEqual(stale.bans, []);
  assert.deepEqual(compactFaceitVeto(null, room), { actions: [] });
});

test('ban rates: how often each team banned each map, and its usual first ban', () => {
  const games = [
    match('r1', B, C, { winner: 'faction1', score: { faction1: 2, faction2: 1 }, day: 2 }),
    match('r2', A, B, { winner: 'faction1', score: { faction1: 2, faction2: 0 }, day: 3 }),
    match('r3', B, C, { status: 'CANCELLED', day: 4 })
  ];
  const vetoById = new Map([
    ['r1', compactFaceitVeto(vetoHistory(), games[0])],
    // A playoff veto the bot ran: FUELED BY HATE is teamB there.
    ['r2', compactBotVeto({ status: 'complete', teamA: 'Celestial Esports', teamB: 'FUELED BY HATE', actions: [{ team: 'teamA', action: 'ban', map: 'de_nuke' }, { team: 'teamB', action: 'ban', map: 'de_mirage' }, { team: 'teamB', action: 'ban', map: 'de_train' }], final: { decider: 'de_ancient' } })],
    ['r3', compactFaceitVeto(vetoHistory(), games[2])]
  ]);
  const rates = teamBanRates({ id: 'tb', name: 'FUELED BY HATE' }, games, vetoById);
  assert.equal(rates.vetoes, 2, 'cancelled matches do not count');
  assert.deepEqual(rates.bans, [{ map: 'Mirage', count: 2 }, { map: 'Inferno', count: 1 }, { map: 'Train', count: 1 }]);
  assert.deepEqual(rates.firstBans[0], { map: 'Mirage', count: 2 });

  const pack = buildPrepPack({ match: match('mx', B, C, { status: 'SCHEDULED', day: 9 }), seasonMatches: games, vetoById, now: Date.UTC(2026, 10, 10) });
  const field = pack.embeds[1].fields.find((entry) => entry.name.startsWith('🚫 Ban rate'));
  assert.equal(field.name, '🚫 Ban rate (2 vetoes)');
  assert.equal(field.value, 'Mirage **100%** (2/2) · Inferno **50%** (1/2) · Train **50%** (1/2)\nFirst ban: Mirage (2 of 2)');
  assert.equal(pack.embeds[2].fields.find((entry) => entry.name.startsWith('🚫 Ban rate')).name, '🚫 Ban rate (1 veto)');
});

test('group stakes with the top 2 going through: round 3 from 2-0, 1-1, 1-1, 0-2', () => {
  const W = ['tw', 'Wolves', []];
  const X = ['tx', 'Xenon', []];
  const Y = ['ty', 'Yeti', []];
  const Z = ['tz', 'Zest', []];
  const win = (id, one, two, day) => match(id, one, two, { winner: 'faction1', score: { faction1: 2, faction2: 0 }, day, group: 'F' });
  const played = [
    win('g1', W, X, 2), win('g2', Y, Z, 2), // round 1: Wolves and Yeti win
    win('g3', W, Y, 3), win('g4', X, Z, 3) // round 2: Wolves 2-0, Xenon 1-1, Yeti 1-1, Zest 0-2
  ];
  const decider = match('g5', X, Y, { status: 'SCHEDULED', day: 4, group: 'F' });
  const other = match('g6', W, Z, { status: 'SCHEDULED', day: 4, group: 'F' });
  const season = [...played, decider, other];

  // 1-1 vs 1-1: the winner is through, the loser is out.
  assert.deepEqual(groupStakes(decider, season, new Map()), [
    '**Elimination match.**',
    'Top 2 in Group F advance.',
    'Xenon: a win sends them through; a loss knocks them out.',
    'Yeti: a win sends them through; a loss knocks them out.'
  ]);
  // 2-0 vs 0-2: Wolves are through whatever happens, Zest are out.
  assert.deepEqual(groupStakes(other, season, new Map()), ['Top 2 in Group F advance.', 'Wolves is already through.', "Zest can't advance anymore."]);
  // Round 1: nothing is decided yet, so just the format.
  const upcoming = (id, one, two) => match(id, one, two, { status: 'SCHEDULED', day: 1, group: 'F' });
  const schedule = [upcoming('s1', W, X), upcoming('s2', Y, Z), upcoming('s3', W, Y), upcoming('s4', X, Z), upcoming('s5', W, Z), upcoming('s6', X, Y)];
  assert.deepEqual(groupStakes(schedule[0], schedule, new Map()), ['Top 2 in Group F advance.']);
  // Not a group match: nothing.
  assert.deepEqual(groupStakes({ ...decider, group: null }, season, new Map()), []);
  // The prep pack's "What's at stake" and the social facts use it.
  const pack = buildPrepPack({ match: decider, seasonMatches: season, now: Date.UTC(2026, 10, 10) });
  assert.match(pack.embeds[0].fields.find((field) => field.name === "🏆 What's at stake").value, /^\*\*Elimination match\.\*\*\nTop 2 in Group F advance\./);
  assert.deepEqual(pack.social.stakes.slice(0, 2), ['**Elimination match.**', 'Top 2 in Group F advance.']);
  assert.deepEqual(pack.social.form.map((team) => `${team.name} ${team.wins}-${team.losses} ${team.streak} ${team.standing}`), [
    'Xenon 1-1 W1 2nd in Group F (1-1)',
    'Yeti 1-1 L1 3rd in Group F (1-1)'
  ]);
  assert.deepEqual(pack.social.h2h, []);
});

test('FACEIT picks only count as the maps once the room is past its veto', () => {
  const room = (status, pick = ['de_mirage']) => ({ status, raw: { status, voting: { map: { pick } } } });
  // Still voting: a partial pick list is not the final maps.
  const voting = vetoSummary({ match: room('VOTING') });
  assert.equal(voting.state, 'in progress');
  assert.deepEqual(voting.maps, []);
  assert.equal(faceitVetoUnderway(room('VOTING')), true);
  assert.equal(vetoSummary({ match: room('SCHEDULED') }).state, 'not yet');
  for (const status of ['CONFIGURING', 'READY', 'ONGOING', 'FINISHED']) {
    assert.deepEqual(vetoSummary({ match: room(status, ['de_mirage', 'de_nuke']) }).maps.map((entry) => entry.map), ['Mirage', 'Nuke'], status);
    assert.equal(faceitVetoUnderway(room(status)), false, status);
  }
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
  assert.equal(teamCard.description, '[FACEIT](https://www.faceit.com/en/teams/ta) · [HLTV](https://hltv.org/x)');
  assert.match(teamCard.fields.find((field) => field.name === '📅 Season 7').value, /\*\*W\*\* \[2-1 vs FUELED BY HATE\]\(https:\/\/www\.faceit\.com\/en\/cs2\/room\/m3\)/);
  assert.match(pack.embeds[0].fields.find((field) => field.name === '⚔️ H2H').value, /^\[Celestial Esports won 2-1\]\(https:\/\/www\.faceit\.com\/en\/cs2\/room\/m3\)/);
  assert.match(teamCard.fields.find((field) => field.name === '👥 Roster').value, /^Zeph \(C\)$/m);
  assert.match(teamCard.fields.find((field) => field.name === '👥 Roster').value, /^Ringer · stand-in$/m);
  assert.doesNotMatch(teamCard.fields.find((field) => field.name === '👥 Roster').value, /lvl/);
  assert.match(teamCard.fields.find((field) => field.name === '📊 Record').value, /1st in Group I \(2-0\)/);
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
  // The whole veto in the order it happened, each played map numbered.
  assert.equal(summary, [
    'Train · Celestial Esports ban',
    'Vertigo · FUELED BY HATE ban',
    '**Mirage** · Celestial Esports pick → Map 1',
    '**Dust2** · FUELED BY HATE pick → Map 2',
    '**Nuke** · decider (left over) → Map 3'
  ].join('\n'));
  assert.equal(pack.embeds.length, 3, 'match and two teams; map facts are their own reply');
  assert.equal(pack.mapFacts.title, '🗺️ Map facts');
  const fields = pack.mapFacts.fields;
  const mirage = fields.find((field) => field.name === '📍 Map 1 · Mirage (Celestial Esports pick)').value;
  assert.match(mirage, /\*\*Celestial Esports\*\* 2-0 · last: \[W 13-9 vs FUELED BY HATE\]\(https:\/\/www\.faceit\.com\/en\/cs2\/room\/m3\) · best: Zeph 1\.42 K\/D, 80 ADR here/);
  assert.match(mirage, /\*\*FUELED BY HATE\*\* 0-1 · last: \[L 9-13 vs Celestial Esports\]/);
  assert.match(mirage, /H2H here: \[Celestial Esports won 13-9\]/);
  assert.match(fields.find((field) => field.name === '📍 Map 2 · Dust2 (FUELED BY HATE pick)').value, /first time on Dust2 this season/);
  assert.match(fields.find((field) => field.name === '📍 Map 3 · Nuke (decider)').value, /\*\*FUELED BY HATE\*\* 1-0/);
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
  assert.deepEqual(names, ['👥 Roster', '📊 Record', '📅 Season 7', '🗺️ Map pool', '⭐ Top players']);
});

test('record shows the round differential; top players show kills and deaths first', () => {
  const tonight = match('m8', A, B, { status: 'READY', day: 9 });
  const pack = buildPrepPack({ match: tonight, seasonMatches, statsById });
  const record = pack.embeds[1].fields.find((field) => field.name === '📊 Record').value;
  // Celestial: m1 13-5, 13-8; m3 13-9, 14-16, 13-11 -> 66 won, 49 lost
  assert.match(record, /Round diff: \*\*\+17\*\* \(66 won, 49 lost\)/);
  assert.match(record, /1st in Group I \(2-0\)/);
  assert.match(pack.embeds[1].fields.find((field) => field.name === '⭐ Top players').value, /^Zeph: 67 K · 47 D · 1\.43 K\/D · /);
  assert.ok(pack.embeds[0].fields.some((field) => field.name === '⚔️ H2H'));
});

test('a single match fetched by ID keeps its Group Stage round, not "Quarter Finals"', async () => {
  const { FaceitClient } = await import('../src/faceit.js');
  const raw = {
    match_id: '1-x', status: 'READY', round: 2, group: 9, competition_id: 'grp', competition_name: 'CROSSFIRE S7 Group Stage',
    teams: { faction1: { faction_id: 'a', name: 'NineFlyeSports', roster: [] }, faction2: { faction_id: 'b', name: 'enigma', roster: [] } }
  };
  const client = new FaceitClient('key', [{ type: 'championship', id: 'grp', name: 'Group Stage' }, { type: 'championship', id: 'po', name: 'Playoffs' }]);
  client.request = async () => raw;
  const match = await client.getMatch('1-x');
  assert.equal(match.round, 'Group Stage - Round 2');
  assert.equal(match.group, 'Group I');
  // Not one of the configured sources: FACEIT's competition name still says it's group stage.
  const other = new FaceitClient('key', []);
  other.request = async () => raw;
  assert.equal((await other.getMatch('1-x')).round, 'Group Stage - Round 2');
  // A playoff source still gets bracket names.
  const playoff = new FaceitClient('key', [{ type: 'championship', id: 'grp', name: 'Playoffs' }]);
  playoff.request = async () => ({ ...raw, group: 1 });
  assert.equal((await playoff.getMatch('1-x')).round, 'Upper Bracket - Round 2');
});
