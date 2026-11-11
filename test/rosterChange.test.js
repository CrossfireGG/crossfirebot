import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRosterChangePost,
  countryName,
  faceitNicknameFromUrl,
  playerFromFaceit,
  faceitTeamIdFromUrl,
  parseDiscordId,
  planRosterOps,
  rosterSlots,
  slotText,
  twitterLink,
  validateNewPlayer
} from '../src/rosterChange.js';

const slot = (label, alias, row, fullName = '') => ({ label, alias, fullName, row });
// starters: rows 4-8, subs 9-10, coach 11 (like a block on the Roster Tracking tab)
const team = ({ starters = ['cap', 'two', 'calamity', 'four', 'five'], subs = ['', ''] } = {}) => ({
  teamName: 'CLUB 333',
  headerRow: 2,
  slots: [
    ...starters.map((alias, index) => slot(`Starter ${index + 1}`, alias, 4 + index, alias ? `Name ${alias}` : '')),
    slot('Sub 1', subs[0], 9), slot('Sub 2', subs[1], 10), slot('Coach', 'coachy', 11, 'Coach Person')
  ]
});
const GOOD = {
  alias: 'zoro-', fullName: 'Zoro Roronoa', discord: 'zoro', discordId: '123456789012345678', nationality: 'USA',
  faceit: 'https://www.faceit.com/en/players/zoro-', hltv: 'hltv.org/player/1/zoro', steamId: '76561198000000001'
};
const player = validateNewPlayer(GOOD).player;

test('the new player is checked field by field', () => {
  assert.equal(validateNewPlayer(GOOD).ok, true);
  assert.equal(player.hltv, 'https://hltv.org/player/1/zoro', 'links get https:// added');
  const bad = validateNewPlayer({ ...GOOD, steamId: '12345', faceit: 'https://steamcommunity.com/x', hltv: '', alias: ' ' });
  assert.deepEqual(bad.errors, [
    'IGN is required.',
    'FACEIT Profile must be a faceit.com link.',
    'HLTV Profile is required.',
    'SteamID64 must be 17 digits and start with 7656119.'
  ]);
  assert.equal(validateNewPlayer({ ...GOOD, steamId: '7656 1198 0000 0000 1' }).ok, true, 'spaces in the SteamID are ignored');
});

test('typed Discord IDs must be 17-20 digits; Twitter handles become links', () => {
  assert.equal(parseDiscordId('<@123456789012345678>'), '123456789012345678');
  assert.equal(parseDiscordId('1234'), null);
  assert.equal(twitterLink('@Zoro_CS'), 'https://x.com/Zoro_CS');
  assert.equal(twitterLink('x.com/zoro'), 'https://x.com/zoro');
  assert.equal(twitterLink(''), '');
});

test('the roster list: starters and subs, coach left out', () => {
  assert.deepEqual(rosterSlots(team()).map(slotText), [
    'Starter 1 · cap (Name cap)', 'Starter 2 · two (Name two)', 'Starter 3 · calamity (Name calamity)',
    'Starter 4 · four (Name four)', 'Starter 5 · five (Name five)', 'Sub 1 · empty', 'Sub 2 · empty'
  ]);
});

test('add: into the first open starter or sub slot', () => {
  const asSub = planRosterOps(team(), { kind: 'add', joinAs: 'sub', player });
  assert.deepEqual(asSub.ops, [{ op: 'write', row: 9, player }]);
  assert.equal(asSub.summary, 'Adding **zoro-** as Sub 1.');
  assert.equal(asSub.logLine, 'CLUB 333: +"zoro-"');
  assert.match(planRosterOps(team(), { kind: 'add', joinAs: 'starter', player }).error, /no open starter slot/);
  const open = planRosterOps(team({ starters: ['cap', 'two', '', 'four', 'five'] }), { kind: 'add', joinAs: 'starter', player });
  assert.equal(open.newSlotLabel, 'Starter 3');
});

test('remove: clear the slot, or put the new player in it', () => {
  const plain = planRosterOps(team(), { kind: 'remove', slotLabel: 'Starter 3' });
  assert.deepEqual(plain.ops, [{ op: 'clear', row: 6 }]);
  assert.deepEqual(plain.expect, [{ row: 6, alias: 'calamity' }]);
  assert.equal(plain.summary, 'Removing **calamity** (Starter 3).');
  const replaced = planRosterOps(team(), { kind: 'remove', slotLabel: 'Starter 3', player });
  assert.deepEqual(replaced.ops, [{ op: 'write', row: 6, player }]);
  assert.equal(replaced.summary, 'Removing **calamity** (Starter 3), adding **zoro-** as Starter 3.');
  assert.equal(replaced.logLine, 'CLUB 333: -"calamity" +"zoro-"');
});

test('move to sub: copy to the first open sub; subs full is still sent without a sheet change', () => {
  const moved = planRosterOps(team({ subs: ['benchy', ''] }), { kind: 'sub', slotLabel: 'Starter 3', player });
  assert.deepEqual(moved.ops, [{ op: 'copy', from: 6, to: 10 }, { op: 'write', row: 6, player }]);
  assert.deepEqual(moved.expect, [{ row: 6, alias: 'calamity' }, { row: 10, alias: '' }]);
  assert.equal(moved.summary, 'Moving **calamity** to Sub 2, adding **zoro-** as Starter 3.');
  const full = planRosterOps(team({ subs: ['a', 'b'] }), { kind: 'sub', slotLabel: 'Starter 3' });
  assert.equal(full.ok, true);
  assert.equal(full.sheetChange, false);
  assert.deepEqual(full.ops, []);
  assert.match(full.warning, /Both sub slots are full/);
  assert.match(planRosterOps(team({ subs: ['benchy', ''] }), { kind: 'sub', slotLabel: 'Sub 1' }).error, /already a sub/);
});

test('promote: into an open starter slot, or swap with a starter', () => {
  const open = planRosterOps(team({ starters: ['cap', 'two', '', 'four', 'five'], subs: ['benchy', ''] }), { kind: 'promote', slotLabel: 'Sub 1' });
  assert.deepEqual(open.ops, [{ op: 'copy', from: 9, to: 6 }, { op: 'clear', row: 9 }]);
  assert.equal(open.summary, 'Promoting **benchy** to Starter 3.');
  const needsSwap = planRosterOps(team({ subs: ['benchy', ''] }), { kind: 'promote', slotLabel: 'Sub 1' });
  assert.equal(needsSwap.ok, false);
  assert.equal(needsSwap.needsSwap, true);
  const swap = planRosterOps(team({ subs: ['benchy', ''] }), { kind: 'promote', slotLabel: 'Sub 1', swapLabel: 'Starter 2' });
  assert.deepEqual(swap.ops, [{ op: 'swap', a: 9, b: 5 }]);
  assert.equal(swap.summary, 'Promoting **benchy** to Starter 2, moving **two** to Sub 1.');
  assert.equal(swap.logLine, 'CLUB 333: "benchy" to starter, "two" to sub');
  assert.match(planRosterOps(team(), { kind: 'promote', slotLabel: 'Starter 1' }).error, /already a starter/);
});

test('the admin post: team, group, requester, change, new player, ticket link', () => {
  const plan = planRosterOps(team(), { kind: 'remove', slotLabel: 'Starter 3', player });
  const post = buildRosterChangePost({ teamName: 'CLUB 333', group: 'Group C', requesterId: '42', plan, player, ticketChannelId: '777', nowMs: Date.UTC(2026, 10, 11) });
  assert.equal(post.title, '🔁 Roster change · CLUB 333');
  assert.equal(post.description, 'Please update this roster on FACEIT.');
  const field = (name) => post.fields.find((entry) => entry.name.startsWith(name))?.value;
  assert.equal(field('Group'), 'Group C');
  assert.equal(field('Change'), 'Removing **calamity** (Starter 3), adding **zoro-** as Starter 3.');
  assert.match(field('Player added (Starter 3)'), /\*\*IGN:\*\* zoro-[\s\S]*\*\*SteamID64:\*\* 76561198000000001[\s\S]*\*\*Discord:\*\* <@123456789012345678> \(zoro\)/);
  assert.equal(field('Ticket'), '<#777>');
  assert.equal(field('Sheet'), 'Updated');
  const full = buildRosterChangePost({ teamName: 'CLUB 333', requesterId: '42', plan: planRosterOps(team({ subs: ['a', 'b'] }), { kind: 'sub', slotLabel: 'Starter 3' }) });
  assert.match(full.description, /⚠️ Both sub slots are full/);
  assert.equal(full.fields.find((entry) => entry.name === 'Group').value, 'Unknown');
});

test('FACEIT team IDs come out of the Team Faceit link', () => {
  assert.equal(faceitTeamIdFromUrl('https://www.faceit.com/en/team-home/ee2358dc-3699-4a4d-b701-615d049d2a38/overview'), 'ee2358dc-3699-4a4d-b701-615d049d2a38');
  assert.equal(faceitTeamIdFromUrl('https://x.com/team'), null);
});

test('FACEIT profile links fill in the IGN, SteamID64 and nationality', () => {
  assert.equal(faceitNicknameFromUrl('https://www.faceit.com/en/players/zoro-'), 'zoro-');
  assert.equal(faceitNicknameFromUrl('https://www.faceit.com/en/players/Zoro/stats/cs2'), 'Zoro');
  assert.equal(faceitNicknameFromUrl('faceit.com/players/zoro'), 'zoro');
  assert.equal(faceitNicknameFromUrl('https://www.faceit.com/pt-br/players-modal/zoro'), 'zoro');
  assert.equal(faceitNicknameFromUrl('https://www.faceit.com/en/teams/abc'), null);
  assert.equal(faceitNicknameFromUrl('zoro'), null);
  assert.equal(countryName('us'), 'United States');
  assert.equal(countryName(''), '');
  assert.deepEqual(playerFromFaceit({ nickname: 'zoro-', country: 'ca', steam_id_64: '76561198000000001' }), {
    alias: 'zoro-', steamId: '76561198000000001', nationality: 'Canada', faceit: 'https://www.faceit.com/en/players/zoro-'
  });
  assert.equal(playerFromFaceit({ nickname: 'x', games: { cs2: { game_player_id: '76561198000000002' } } }).steamId, '76561198000000002', 'from the CS2 game id');
  assert.equal(playerFromFaceit({ nickname: 'x', steam_id_64: '' }).steamId, '', 'no Steam linked');
  assert.equal(playerFromFaceit({}), null);
});

test('the admin post lists the Discord role changes', () => {
  const plan = planRosterOps(team(), { kind: 'remove', slotLabel: 'Starter 3', player });
  const post = buildRosterChangePost({ teamName: 'CLUB 333', requesterId: '42', plan, player, roles: ['🎭 Gave <@1> **CLUB 333** and **Season Participant**.'] });
  assert.equal(post.fields.find((field) => field.name === 'Discord roles').value, '🎭 Gave <@1> **CLUB 333** and **Season Participant**.');
  assert.equal(buildRosterChangePost({ teamName: 'CLUB 333', requesterId: '42', plan }).fields.some((field) => field.name === 'Discord roles'), false);
});

test('Roster History rows: one per player affected, with their FACEIT link or roster row', () => {
  const remove = planRosterOps(team(), { kind: 'remove', slotLabel: 'Starter 3', player });
  assert.deepEqual(remove.history, [
    { action: 'Removed', player: 'calamity', spot: 'Starter 3', faceitRow: 6 },
    { action: 'Added', player: 'zoro-', spot: 'Starter 3', faceit: 'https://www.faceit.com/en/players/zoro-' }
  ]);
  assert.deepEqual(planRosterOps(team({ subs: ['benchy', ''] }), { kind: 'sub', slotLabel: 'Starter 3' }).history,
    [{ action: 'Moved to sub', player: 'calamity', spot: 'Starter 3 → Sub 2', faceitRow: 6 }]);
  assert.deepEqual(planRosterOps(team({ subs: ['benchy', ''] }), { kind: 'promote', slotLabel: 'Sub 1', swapLabel: 'Starter 2' }).history, [
    { action: 'Promoted', player: 'benchy', spot: 'Sub 1 → Starter 2', faceitRow: 9 },
    { action: 'Moved to sub', player: 'two', spot: 'Starter 2 → Sub 1', faceitRow: 5 }
  ]);
  assert.deepEqual(planRosterOps(team(), { kind: 'add', joinAs: 'sub', player }).history,
    [{ action: 'Added', player: 'zoro-', spot: 'Sub 1', faceit: 'https://www.faceit.com/en/players/zoro-' }]);
  const full = planRosterOps(team({ subs: ['a', 'b'] }), { kind: 'sub', slotLabel: 'Starter 3', player });
  assert.deepEqual(full.history.map((row) => row.action), ['Sent to admin: move to sub (subs full)', 'Sent to admin: add (subs full)'], 'still recorded when the sheet is left for an admin');
});
