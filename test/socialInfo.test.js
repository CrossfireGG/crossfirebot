import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeHandle, teamSocials, buildRoundup, buildSocialCard, buildSocialResultCard, matchTopPlayer } from '../src/socialInfo.js';
import { parseTeamInfoRows, buildPrepPack } from '../src/prepPack.js';

const NINE_30 = Date.UTC(2026, 10, 13, 2, 30); // Thu Nov 12, 9:30 PM ET
const EIGHT = Date.UTC(2026, 10, 13, 1, 0);

test('team handles from the Team Info tab', () => {
  assert.equal(normalizeHandle('@FBH_CS'), '@FBH_CS');
  assert.equal(normalizeHandle('https://x.com/FBH_CS'), '@FBH_CS');
  assert.equal(normalizeHandle('instagram.com/fueledbyhate/'), '@fueledbyhate');
  assert.equal(normalizeHandle('none'), null);
  const [team] = parseTeamInfoRows([
    [{ text: 'Name' }, { text: 'X' }, { text: 'Instagram' }, { text: 'Notes' }],
    [{ text: 'FUELED BY HATE' }, { text: '@FBH_CS' }, { text: 'IG', link: 'https://instagram.com/fueledbyhate' }, { text: 'Runners-up' }]
  ]);
  assert.deepEqual(teamSocials(team), { x: '@FBH_CS', instagram: '@fueledbyhate' });
});

test('handles stay out of the prep pack notes and links', () => {
  const info = parseTeamInfoRows([
    [{ text: 'Name' }, { text: 'X' }, { text: 'Notes' }],
    [{ text: 'Alpha' }, { text: '@alpha' }, { text: '' }]
  ]);
  const match = {
    id: 'm', status: 'READY', teamA: 'Alpha', teamB: 'Beta',
    raw: { teams: { faction1: { faction_id: 'a', name: 'Alpha', roster: [] }, faction2: { faction_id: 'b', name: 'Beta', roster: [] } } }
  };
  const pack = buildPrepPack({ match, teamInfo: info });
  assert.equal(pack.notes.length, 0, 'a handle alone is not a note');
  assert.doesNotMatch(pack.embeds[1].description || '', /@alpha|\bX\b/);
});

test('the daily roundup lists the main stream crew and every community cast', () => {
  const card = buildRoundup({
    dateMs: NINE_30,
    mainStream: [{
      startMs: NINE_30, teamA: 'FUELED BY HATE', teamB: 'Celestial Esports', socialsA: { x: '@FBH_CS' }, socialsB: {},
      streamUrl: 'https://twitch.tv/playcrossfire', crew: { casters: ['1', '2'], producer: '3', observer: '4', admin: '5', social: '6' }
    }],
    community: [{
      startMs: EIGHT, teamA: 'NXG Esports', teamB: 'Solar Gravity', socialsA: { x: '@NXG' }, socialsB: {},
      casts: [{ url: 'https://twitch.tv/az19999', userId: '9' }, { url: 'https://twitch.tv/iamfusiion', userId: '8' }]
    }]
  });
  assert.equal(card.title, '📣 Tonight on stream · Thu, Nov 12');
  assert.match(card.description, /\*\*9:30 PM ET\*\* · FUELED BY HATE \(@FBH_CS\) vs Celestial Esports/);
  assert.match(card.description, /🎙️ Casters: <@1> & <@2>\n🎬 Producer: <@3> · 👁️ Observer: <@4>/);
  assert.doesNotMatch(card.description, /<@5>|<@6>|Admin|Social/, 'no admin or social media in the roundup');
  assert.match(card.description, /\*\*8:00 PM ET\*\* · NXG Esports \(@NXG\) vs Solar Gravity\n  \[twitch\.tv\/az19999\]\(https:\/\/twitch\.tv\/az19999\) \(<@9>\) & \[twitch\.tv\/iamfusiion\]\(https:\/\/twitch\.tv\/iamfusiion\) \(<@8>\) \(co-cast\)/);
  assert.equal(buildRoundup({ dateMs: NINE_30 }).description, 'Nothing on stream tonight.');
});

test('the main stream social card: before, live, final', () => {
  const base = {
    startMs: NINE_30, teamA: 'FUELED BY HATE', teamB: 'Celestial Esports', socialsA: { x: '@FBH_CS', instagram: '@fbh' }, socialsB: {},
    streamUrl: 'https://twitch.tv/playcrossfire', crew: { casters: ['1'], producer: '3' }, round: 'Group Stage - Round 3', group: 'I',
    storylines: ['Rematch: Celestial Esports won their last meeting 2-1.'], stars: [{ team: 'FUELED BY HATE', nickname: 'CULIACAN', kd: 1.19, adr: 85 }]
  };
  const before = buildSocialCard(base).description;
  assert.match(before, /\*\*When:\*\* Thu, Nov 12 · 9:30 PM ET \/ 8:30 PM CT/);
  assert.match(before, /\*\*X tags\*\*\nFUELED BY HATE: @FBH_CS\nCelestial Esports: none on file/);
  assert.doesNotMatch(before, /IG|@fbh\b|Instagram/, 'no Instagram');
  assert.match(before, /\*\*Maps:\*\* not locked yet/);
  assert.match(before, /FUELED BY HATE: CULIACAN, 1\.19 K\/D, 85 ADR/);
  assert.match(buildSocialCard({ ...base, state: 'live', maps: ['Mirage', 'Dust2', 'Nuke'] }).description, /^🔴 \*\*LIVE NOW\*\*[\s\S]*Maps:\*\* Mirage → Dust2 → Nuke/);
  // Once the match is over the before-game post goes back to plain facts: no LIVE banner, no result.
  const over = buildSocialCard({ ...base, state: 'over', maps: ['Mirage', 'Dust2', 'Nuke'] }).description;
  assert.doesNotMatch(over, /LIVE NOW|Final|Top player/);
  assert.match(over, /^\*\*When:\*\*/);
});

test('the before-game post has stakes, form and head to head', () => {
  const card = buildSocialCard({
    startMs: NINE_30, teamA: 'Xenon', teamB: 'Yeti',
    stakes: ['**Elimination match.**', 'Top 2 in Group F advance.', 'Xenon: a win sends them through; a loss knocks them out.'],
    form: [
      { name: 'Xenon', wins: 1, losses: 1, streak: 'W1', standing: '2nd in Group F (1-1)' },
      { name: 'Yeti', wins: 0, losses: 0, streak: null, standing: null }
    ],
    h2h: [],
    storylines: ['First meeting this season.', 'Xenon has a stand-in: Ringer.']
  }).description;
  assert.match(card, /\*\*What's at stake\*\*\n\*\*Elimination match\.\*\*\nTop 2 in Group F advance\.\nXenon: a win sends them through; a loss knocks them out\./);
  assert.match(card, /\*\*Form\*\*\nXenon: 1-1 · W1 streak · 2nd in Group F \(1-1\)\nYeti: first match of the season/);
  assert.match(card, /\*\*Head to head\*\*\nFirst meeting this season\./);
  // The first-meeting storyline isn't repeated under Storylines.
  assert.match(card, /\*\*Storylines\*\*\n• Xenon has a stand-in: Ringer\.$/m);
  assert.equal(card.match(/First meeting/g).length, 1);
  // Cards saved before these facts existed just leave the sections out.
  assert.doesNotMatch(buildSocialCard({ startMs: NINE_30, teamA: 'A', teamB: 'B' }).description, /Form|Head to head|What's at stake/);
});

test('the after-game post is its own card: result, map scores, top player, tags, stream', () => {
  const card = buildSocialResultCard({
    teamA: 'FUELED BY HATE', teamB: 'Celestial Esports', socialsA: { x: '@FBH_CS' }, socialsB: {},
    streamUrl: 'https://twitch.tv/playcrossfire',
    result: 'Celestial Esports won 2-1 (Mirage 13-9, Nuke 14-16, Ancient 13-11)',
    topPlayer: { nickname: 'Zeph', team: 'Celestial Esports', kills: 62, deaths: 40, adr: 101.4 }
  });
  assert.equal(card.title, '🏆 Final · FUELED BY HATE vs Celestial Esports');
  assert.equal(card.description, [
    '**Final:** Celestial Esports won 2-1',
    '',
    '**Maps**',
    'Mirage 13-9',
    'Nuke 14-16',
    'Ancient 13-11',
    '',
    '**Top player:** Zeph (Celestial Esports), 62 K · 40 D · 101 ADR',
    '',
    '**X tags**',
    'FUELED BY HATE: @FBH_CS',
    'Celestial Esports: none on file',
    '',
    '**Stream:** [twitch.tv/playcrossfire](https://twitch.tv/playcrossfire)'
  ].join('\n'));
  // No map scores or top player on file: just the result.
  assert.match(buildSocialResultCard({ teamA: 'A', teamB: 'B', result: 'A won 2-0' }).description, /^\*\*Final:\*\* A won 2-0\n\n\*\*X tags\*\*/);
});

test('a match\'s top player', () => {
  const stats = { maps: [
    { map: 'Mirage', teams: [{ name: 'A', players: [{ playerId: 'p1', nickname: 'Zeph', kills: 25, deaths: 10, adr: 100 }] }, { name: 'B', players: [{ playerId: 'p2', nickname: 'Delta', kills: 20, deaths: 20, adr: 80 }] }] },
    { map: 'Nuke', teams: [{ name: 'A', players: [{ playerId: 'p1', nickname: 'Zeph', kills: 15, deaths: 15, adr: 70 }] }, { name: 'B', players: [{ playerId: 'p2', nickname: 'Delta', kills: 30, deaths: 12, adr: 110 }] }] }
  ] };
  assert.equal(matchTopPlayer(stats).nickname, 'Delta');
});
