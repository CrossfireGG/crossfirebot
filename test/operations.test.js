import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PermissionFlagsBits } from 'discord.js';
import { makeMatchPermissionOverwrites } from '../src/discordProvision.js';
import { isAuthorizedStaffMember, parseForceDirective } from '../src/operationsPolicy.js';
import { applyVetoAction, chooseFirstAction, createVeto } from '../src/vetoEngine.js';
import { validateStreamRequest } from '../src/streamRequest.js';

const match = { id: 'match-1', teamA: 'Alpha', teamB: 'Bravo' };
const mapPool = ['Ancient', 'Anubis', 'Dust2', 'Inferno', 'Mirage', 'Nuke', 'Train'];

test('veto enforces higher-seed choice, turn order, and unique maps', () => {
  const veto = createVeto({ match, mapPool, seeds: { teamA: 1, teamB: 8, source: 'test seed table' }, format: 'bo3' });
  assert.throws(() => chooseFirstAction(veto, 'teamB', 'self'), /higher-seeded/);
  const active = chooseFirstAction(veto, 'teamA', 'opponent');
  assert.equal(active.currentTeam, 'teamB');
  const afterBan = applyVetoAction(active, 'teamB', 'Ancient');
  assert.throws(() => applyVetoAction(afterBan, 'teamB', 'Anubis'), /not your team/);
  assert.throws(() => applyVetoAction(afterBan, 'teamA', 'Ancient'), /no longer available/);
});

test('grand-final veto awards the remaining map to the configured upper-bracket winner', () => {
  assert.throws(() => createVeto({ match, mapPool, seeds: { teamA: 1, teamB: 2 }, format: 'bo5_advantage' }), /advantage team/);
  let veto = createVeto({ match, mapPool, seeds: { teamA: 1, teamB: 2 }, format: 'bo5_advantage', advantageTeam: 'teamB' });
  veto = chooseFirstAction(veto, 'teamA', 'self');
  for (const map of mapPool.slice(0, 6)) veto = applyVetoAction(veto, veto.currentTeam, map);
  assert.equal(veto.status, 'complete');
  assert.equal(veto.final.awardedMap, 'Train');
  assert.equal(veto.final.startingScore, '1-0 Bravo');
  assert.equal(veto.final.playableMaps.length, 4);
});

test('staff authorization uses permissions and explicit IDs, never role names', () => {
  const config = { discordStaffRoleId: null, authorizedStaffRoleIds: ['staff-id'] };
  const namedOnly = fakeMember([], [], ['Administrator']);
  assert.equal(isAuthorizedStaffMember(namedOnly, config), false);
  assert.equal(isAuthorizedStaffMember(fakeMember(['staff-id']), config), true);
  assert.equal(isAuthorizedStaffMember(fakeMember([], [PermissionFlagsBits.ManageGuild]), config), true);
});

test('schedule policy override requires an explicit reason', () => {
  assert.deepEqual(parseForceDirective('October 1 9 PM ET'), { scheduleText: 'October 1 9 PM ET', reason: '' });
  assert.deepEqual(parseForceDirective('October 1 9 PM ET --force production conflict'), {
    scheduleText: 'October 1 9 PM ET',
    reason: 'production conflict'
  });
  assert.equal(parseForceDirective('October 1 9 PM ET --force').reason, '');
});

test('match permissions hide everyone and include only both teams and privileged roles', () => {
  const overwrites = makeMatchPermissionOverwrites(
    { id: 'everyone' },
    { id: 'team-a' },
    { id: 'team-b' },
    [{ id: 'ops' }]
  );
  assert.deepEqual(overwrites.map((entry) => entry.id), ['everyone', 'team-a', 'team-b', 'ops']);
  assert(overwrites[0].deny.includes(PermissionFlagsBits.ViewChannel));
  assert(overwrites.slice(1).every((entry) => entry.allow.includes(PermissionFlagsBits.ViewChannel)));
});

test('stream request validates host allowlists and guidelines acknowledgment', () => {
  const valid = validateStreamRequest({
    dateTime: 'October 10, 2026 8 PM EDT',
    matchup: 'Alpha vs Bravo',
    streamUrl: 'https://twitch.tv/example',
    socialUrl: 'https://x.com/example',
    acknowledged: 'I AGREE'
  });
  assert.equal(valid.valid, true);
  const invalid = validateStreamRequest({ ...valid.value, streamUrl: 'https://example.com', acknowledged: 'no' });
  assert.equal(invalid.valid, false);
});

test('persistent decisions are serialized and survive a fresh module load', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crossfire-store-'));
  const dbPath = path.join(tempDir, 'bot-data.json');
  process.env.BOT_DATA_PATH = dbPath;
  const storeA = await import(`../src/store.js?store-a=${Date.now()}`);
  await storeA.createStreamRequest({ id: 'request-1', requesterId: 'user', matchup: 'Alpha vs Bravo' });
  const [first, second] = await Promise.all([
    storeA.updateStreamRequest('request-1', { status: 'approved' }, ['pending']),
    storeA.updateStreamRequest('request-1', { status: 'denied' }, ['pending'])
  ]);
  assert.equal([first, second].filter(Boolean).length, 1);
  await storeA.saveVeto({ matchId: 'match-1', status: 'active' });
  await storeA.saveTeamMapping('guild:season', {
    identity: 'faceit-team-1',
    teamName: 'Old Team Name',
    discordRoleId: 'role-1'
  });
  await storeA.saveTeamMapping('guild:season', {
    identity: 'faceit-team-1',
    teamName: 'New Team Name',
    discordRoleId: 'role-1'
  });
  await storeA.saveSchedule('match-1', {
    scheduledAt: 'October 10, 2026 8 PM EDT',
    scheduledAtIso: '2026-10-11T00:00:00.000Z',
    adminApproved: true
  });
  const storeB = await import(`../src/store.js?store-b=${Date.now()}`);
  assert.equal((await storeB.getVeto('match-1')).status, 'active');
  assert.match((await storeB.getStreamRequest('request-1')).status, /approved|denied/);
  assert.equal((await storeB.listTeamMappings('guild:season'))[0].teamName, 'New Team Name');
  assert.equal((await storeB.listTeamMappings('guild:season'))[0].discordRoleId, 'role-1');
  assert.equal((await storeB.getSchedule('match-1')).scheduledAtIso, '2026-10-11T00:00:00.000Z');
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('post-cast reminder claims are atomic and survive restart', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crossfire-reminder-'));
  process.env.BOT_DATA_PATH = path.join(tempDir, 'bot-data.json');
  const store = await import(`../src/store.js?reminder-a=${Date.now()}`);
  await store.createStreamRequest({ id: 'approved-1', requesterId: 'user', matchup: 'Alpha vs Bravo', status: 'approved' });
  const claims = await Promise.all([
    store.claimPostCastReminder('approved-1'),
    store.claimPostCastReminder('approved-1')
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  const reloaded = await import(`../src/store.js?reminder-b=${Date.now()}`);
  assert.equal(await reloaded.claimPostCastReminder('approved-1'), null);
  await fs.rm(tempDir, { recursive: true, force: true });
});

function fakeMember(roleIds = [], permissionIds = [], roleNames = []) {
  return {
    permissions: { has: (permission) => permissionIds.includes(permission) },
    roles: {
      cache: {
        has: (id) => roleIds.includes(id),
        some: (predicate) => roleNames.some((name) => predicate({ name }))
      }
    }
  };
}
