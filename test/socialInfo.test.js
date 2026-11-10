import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeHandle, teamSocials, buildRoundup, buildSocialCard, matchTopPlayer } from '../src/socialInfo.js';
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
  const done = buildSocialCard({ ...base, state: 'done', result: 'Celestial Esports won 2-1 (Mirage 13-9)', topPlayer: { nickname: 'Zeph', team: 'Celestial Esports', kills: 62, deaths: 40, adr: 101.4 } }).description;
  assert.match(done, /^🏆 \*\*Final: Celestial Esports won 2-1 \(Mirage 13-9\)\*\*/);
  assert.match(done, /\*\*Top player:\*\* Zeph \(Celestial Esports\), 62 K · 40 D · 101 ADR/);
});

test('a match\'s top player', () => {
  const stats = { maps: [
    { map: 'Mirage', teams: [{ name: 'A', players: [{ playerId: 'p1', nickname: 'Zeph', kills: 25, deaths: 10, adr: 100 }] }, { name: 'B', players: [{ playerId: 'p2', nickname: 'Delta', kills: 20, deaths: 20, adr: 80 }] }] },
    { map: 'Nuke', teams: [{ name: 'A', players: [{ playerId: 'p1', nickname: 'Zeph', kills: 15, deaths: 15, adr: 70 }] }, { name: 'B', players: [{ playerId: 'p2', nickname: 'Delta', kills: 30, deaths: 12, adr: 110 }] }] }
  ] };
  assert.equal(matchTopPlayer(stats).nickname, 'Delta');
});
