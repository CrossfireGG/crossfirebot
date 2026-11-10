import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRosterChangePost,
  changeLogLine,
  faceitTeamIdFromUrl,
  parseDiscordId,
  planRosterChange,
  rosterSlots,
  slotText,
  twitterLink,
  validateNewPlayer
} from '../src/rosterChange.js';

const slot = (label, alias = '', fullName = '', row = 0) => ({ label, alias, fullName, row });
const team = (subs = ['', '']) => ({
  teamName: 'CLUB 333',
  headerRow: 78,
  slots: [
    slot('Starter 1', 'cap', 'Cap Tain', 81), slot('Starter 2', 'two', 'Two Person', 82), slot('Starter 3', 'calamity', 'Cal Amity', 83),
    slot('Starter 4', 'four', '', 84), slot('Starter 5', 'five', '', 85),
    slot('Sub 1', subs[0], '', 86), slot('Sub 2', subs[1], '', 87), slot('Coach', 'coachy', 'Coach Person', 88)
  ]
});
const GOOD = {
  alias: 'zoro-', fullName: 'Zoro Roronoa', discord: 'zoro', discordId: '123456789012345678', nationality: 'USA',
  faceit: 'https://www.faceit.com/en/players/zoro-', hltv: 'hltv.org/player/1/zoro', steamId: '76561198000000001'
};

test('the new player is checked field by field', () => {
  const ok = validateNewPlayer(GOOD);
  assert.equal(ok.ok, true);
  assert.equal(ok.player.hltv, 'https://hltv.org/player/1/zoro', 'links get https:// added');
  const bad = validateNewPlayer({ ...GOOD, steamId: '12345', faceit: 'https://steamcommunity.com/x', hltv: '', alias: ' ' });
  assert.deepEqual(bad.errors, [
    'IGN is required.',
    'FACEIT Profile must be a faceit.com link.',
    'HLTV Profile is required.',
    'SteamID64 must be 17 digits and start with 7656119.'
  ]);
  assert.match(validateNewPlayer({ ...GOOD, steamId: '76561198' }).errors[0], /17 digits/);
  assert.equal(validateNewPlayer({ ...GOOD, steamId: '7656 1198 0000 0000 1' }).ok, true, 'spaces in the SteamID are ignored');
});

test('typed Discord IDs must be 17-20 digits', () => {
  assert.equal(parseDiscordId('<@123456789012345678>'), '123456789012345678');
  assert.equal(parseDiscordId(' 123456789012345678 '), '123456789012345678');
  assert.equal(parseDiscordId('1234'), null);
  assert.equal(parseDiscordId('zoro'), null);
});

test('the roster dropdown: starters and subs, coach left out', () => {
  assert.deepEqual(rosterSlots(team()).map(slotText), [
    'Starter 1 · cap (Cap Tain)', 'Starter 2 · two (Two Person)', 'Starter 3 · calamity (Cal Amity)',
    'Starter 4 · four', 'Starter 5 · five', 'Sub 1 · empty', 'Sub 2 · empty'
  ]);
});

test('remove, move to sub, open slot, and full subs', () => {
  const remove = planRosterChange(team(), 'Starter 3', 'remove', 'zoro-');
  assert.equal(remove.summary, 'Adding **zoro-** as Starter 3, removing **calamity** from the team.');
  assert.equal(changeLogLine('CLUB 333', remove, GOOD), 'CLUB 333: -"calamity" +"zoro-"');

  const sub = planRosterChange(team(['benchy', '']), 'Starter 3', 'sub', 'zoro-');
  assert.equal(sub.subSlot.label, 'Sub 2', 'the first empty sub slot');
  assert.equal(sub.summary, 'Adding **zoro-** as Starter 3, moving **calamity** to Sub 2.');
  assert.equal(sub.warning, null);
  assert.equal(changeLogLine('CLUB 333', sub, GOOD), 'CLUB 333: +"zoro-" ("calamity" to sub)');

  const full = planRosterChange(team(['benchy', 'other']), 'Starter 3', 'sub', 'zoro-');
  assert.equal(full.ok, true, 'still submitted');
  assert.equal(full.subsFull, true);
  assert.match(full.warning, /Both sub slots are full/);

  const open = planRosterChange(team(), 'Sub 1', 'open', 'zoro-');
  assert.equal(open.summary, 'Adding **zoro-** in the open Sub 1 slot.');
  assert.equal(changeLogLine('CLUB 333', open, GOOD), 'CLUB 333: +"zoro-"');

  assert.equal(planRosterChange(team(['benchy', '']), 'Sub 1', 'sub').ok, false, 'a sub cannot move to sub');
  assert.equal(planRosterChange(team(), 'Sub 1', 'remove').ok, false, 'nobody to remove in an empty slot');
  assert.equal(planRosterChange(team(), 'Starter 9', 'remove').ok, false);
});

test('the admin post: team, group, requester, player, change, FACEIT note, full-subs warning', () => {
  const plan = planRosterChange(team(), 'Starter 3', 'sub', 'zoro-');
  const post = buildRosterChangePost({ teamName: 'CLUB 333', group: 'Group C', requesterId: '42', player: validateNewPlayer(GOOD).player, plan, nowMs: Date.UTC(2026, 10, 11) });
  assert.equal(post.title, '🔁 Roster change · CLUB 333');
  assert.equal(post.description, 'Please update this roster on FACEIT.');
  const field = (name) => post.fields.find((entry) => entry.name.startsWith(name)).value;
  assert.equal(field('Group'), 'Group C');
  assert.equal(field('Requested by'), '<@42>');
  assert.match(field('Player added (Starter 3)'), /\*\*IGN:\*\* zoro-\n\*\*Full name:\*\* Zoro Roronoa\n\*\*Nationality:\*\* USA\n\*\*FACEIT:\*\* https:\/\/www\.faceit\.com\/en\/players\/zoro-\n\*\*HLTV:\*\* https:\/\/hltv\.org\/player\/1\/zoro\n\*\*SteamID64:\*\* 76561198000000001\n\*\*Discord:\*\* <@123456789012345678> \(zoro\)/);
  assert.equal(field('Player moved to sub'), 'Moved to sub: **calamity** (was Starter 3, now Sub 1)');
  assert.equal(field('Sheet'), 'Updated');

  const fullPlan = planRosterChange(team(['a', 'b']), 'Starter 3', 'sub', 'zoro-');
  const fullPost = buildRosterChangePost({ teamName: 'CLUB 333', requesterId: '42', player: validateNewPlayer(GOOD).player, plan: fullPlan, sheetUpdated: false });
  assert.match(fullPost.description, /⚠️ Both sub slots are full, so the sheet was \*\*not\*\* changed/);
  assert.equal(fullPost.fields.find((entry) => entry.name === 'Group').value, 'Unknown');
});

test('FACEIT team IDs come out of the Team Faceit link', () => {
  assert.equal(faceitTeamIdFromUrl('https://www.faceit.com/en/team-home/ee2358dc-3699-4a4d-b701-615d049d2a38/overview?cp=main_nav'), 'ee2358dc-3699-4a4d-b701-615d049d2a38');
  assert.equal(faceitTeamIdFromUrl('https://www.faceit.com/en/teams/EE2358DC-3699-4A4D-B701-615D049D2A38'), 'ee2358dc-3699-4a4d-b701-615d049d2a38');
  assert.equal(faceitTeamIdFromUrl('https://x.com/team'), null);
});

test('Twitter/X handles become links for the sheet', () => {
  assert.equal(twitterLink('@Zoro_CS'), 'https://x.com/Zoro_CS');
  assert.equal(twitterLink('zoro_cs'), 'https://x.com/zoro_cs');
  assert.equal(twitterLink('x.com/zoro'), 'https://x.com/zoro');
  assert.equal(twitterLink('https://twitter.com/zoro'), 'https://twitter.com/zoro');
  assert.equal(twitterLink(''), '');
  assert.equal(validateNewPlayer({ twitter: '@zoro' }).player.twitter, 'https://x.com/zoro');
});
