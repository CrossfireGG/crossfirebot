import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PermissionFlagsBits } from 'discord.js';
import { getConfig } from '../src/config.js';
import { makeMatchPermissionOverwrites } from '../src/discordProvision.js';
import { isAuthorizedStaffMember, parseForceDirective } from '../src/operationsPolicy.js';
import { extractFaceitTeamId } from '../src/sheetRoles.js';
import { applyVetoAction, chooseFirstAction, createVeto } from '../src/vetoEngine.js';
import {
  classifyFaceitScheduleChange,
  formatEasternDateTimeInput,
  isCanceledFaceitStatus,
  isTerminalFaceitStatus,
  makeStreamRequestModalId,
  parseFaceitMatchRoomLink,
  parseEasternDateTime,
  parseStreamRequestModalId,
  validateStreamDelivery,
  validateStreamRequest
} from '../src/streamRequest.js';

const match = { id: 'match-1', teamA: 'Alpha', teamB: 'Bravo' };
const mapPool = ['Ancient', 'Anubis', 'Dust2', 'Inferno', 'Mirage', 'Nuke', 'Train'];

test('Season 7 Team FACEIT Link header resolves a stable team identity', () => {
  assert.equal(
    extractFaceitTeamId({ team_faceit_link: 'https://www.faceit.com/en/teams/12345678-1234-1234-1234-123456789abc' }),
    '12345678-1234-1234-1234-123456789abc'
  );
});

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

test('authorized staff role IDs accept spaces, commas, and semicolons', () => {
  const previous = Object.fromEntries([
    'DISCORD_TOKEN',
    'DISCORD_CLIENT_ID',
    'DISCORD_GUILD_ID',
    'FACEIT_API_KEY',
    'FACEIT_SOURCES',
    'AUTHORIZED_STAFF_ROLE_IDS'
  ].map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, {
      DISCORD_TOKEN: 'test-token',
      DISCORD_CLIENT_ID: '111111111111111',
      DISCORD_GUILD_ID: '222222222222222',
      FACEIT_API_KEY: 'test-key',
      FACEIT_SOURCES: 'championship:test-id:Test Championship',
      AUTHORIZED_STAFF_ROLE_IDS: '333333333333333 444444444444444,555555555555555;666666666666666'
    });
    assert.deepEqual(getConfig().authorizedStaffRoleIds, [
      '333333333333333',
      '444444444444444',
      '555555555555555',
      '666666666666666'
    ]);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
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

test('stream request validates host allowlists without a typed acknowledgment', () => {
  const valid = validateStreamRequest({
    dateTime: 'October 10, 2026 8 PM EDT',
    matchup: 'Alpha vs Bravo',
    streamUrl: 'https://twitch.tv/example',
    socialUrl: 'https://x.com/example'
  });
  assert.equal(valid.valid, true);
  const invalid = validateStreamRequest({ ...valid.value, streamUrl: 'https://example.com' });
  assert.equal(invalid.valid, false);
});

test('stream request can derive matchup and schedule from a FACEIT room', () => {
  const result = validateStreamRequest({
    dateTime: '',
    matchup: '',
    streamUrl: 'https://twitch.tv/example',
    socialUrl: 'https://x.com/example',
    matchDetailsRequired: false
  });
  assert.equal(result.valid, true);
  assert.equal(result.value.dateTimeIso, null);
});

test('stream request date errors explain the required Eastern Time format', () => {
  const result = validateStreamRequest({
    dateTime: 'tomorrow sometime',
    matchup: 'Alpha vs Bravo',
    streamUrl: 'https://twitch.tv/example',
    socialUrl: 'https://x.com/example'
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /Eastern Time/);
  assert.match(result.errors.join('\n'), /ET.*,.*EDT.*,.*EST|ET.*EDT.*EST/);
});

test('stream request accepts common Eastern Time date formats and relative dates', () => {
  const now = new Date('2026-10-12T16:00:00.000Z');
  assert.equal(
    new Date(parseEasternDateTime('10/12/2026 8 PM', now)).toISOString(),
    '2026-10-13T00:00:00.000Z'
  );
  assert.equal(
    new Date(parseEasternDateTime('tomorrow at 8:30 PM ET', now)).toISOString(),
    '2026-10-14T00:30:00.000Z'
  );
  assert.equal(
    new Date(parseEasternDateTime('October 14 at 7 PM', now)).toISOString(),
    '2026-10-14T23:00:00.000Z'
  );
  assert.equal(
    parseEasternDateTime('October 14 at 7 PM EDT', now),
    parseEasternDateTime('October 14 at 7 PM EST', now)
  );
  assert.equal(
    parseEasternDateTime('October 14 at 7 PM EST', now),
    parseEasternDateTime('October 14 at 7 PM ET', now)
  );
});

test('FACEIT ISO times are formatted as readable Eastern Time form values', () => {
  assert.equal(formatEasternDateTimeInput('2026-10-13T00:00:00.000Z'), '10/12/2026 8:00 PM ET');
});

test('stream request modal IDs stay below Discord limits for long sample match rooms', () => {
  const customId = makeStreamRequestModalId('252433882991820810', '1558682231172636685');
  assert(customId.length <= 100);
  assert.deepEqual(parseStreamRequestModalId(customId), {
    requesterId: '252433882991820810',
    sourceChannelId: '1558682231172636685'
  });
});

test('FACEIT matchroom links are canonicalized and non-FACEIT links are rejected', () => {
  assert.deepEqual(
    parseFaceitMatchRoomLink('https://www.faceit.com/en/cs2/room/1-ea866b15-315d-4c3f-a41c-2093b63b6c41'),
    {
      matchId: '1-ea866b15-315d-4c3f-a41c-2093b63b6c41',
      url: 'https://www.faceit.com/en/cs2/room/1-ea866b15-315d-4c3f-a41c-2093b63b6c41'
    }
  );
  assert.equal(parseFaceitMatchRoomLink('https://hltv.org/matches/123'), null);
});

test('caster delivery accepts CSTV connect commands and Twitch links', () => {
  assert.equal(validateStreamDelivery('cstv', 'connect 123.45.67.89:27020').valid, true);
  assert.equal(validateStreamDelivery('cstv', '123.45.67.89:27020').valid, false);
  assert.equal(validateStreamDelivery('twitch', 'https://twitch.tv/crossfire').valid, true);
  assert.equal(validateStreamDelivery('twitch', 'https://example.com/live').valid, false);
  assert.equal(validateStreamDelivery('custom', 'Use the CSTV details from tonight\'s lobby.').valid, true);
  assert.equal(validateStreamDelivery('custom', '   ').valid, false);
});

test('stream schedule monitoring distinguishes scheduled, moved, and removed times', () => {
  const first = '2026-11-01T00:00:00.000Z';
  const second = '2026-11-01T01:00:00.000Z';
  assert.equal(classifyFaceitScheduleChange(null, first), 'scheduled');
  assert.equal(classifyFaceitScheduleChange(first, second), 'rescheduled');
  assert.equal(classifyFaceitScheduleChange(first, null), 'unscheduled');
  assert.equal(classifyFaceitScheduleChange(first, first), 'unchanged');
});

test('stream monitoring recognizes completed and canceled FACEIT states', () => {
  assert.equal(isTerminalFaceitStatus('FINISHED'), true);
  assert.equal(isTerminalFaceitStatus('CANCELLED'), true);
  assert.equal(isTerminalFaceitStatus('SCHEDULED'), false);
  assert.equal(isCanceledFaceitStatus('CANCELED'), true);
  assert.equal(isCanceledFaceitStatus('FINISHED'), false);
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

test('accepted Tournament Ops schedules remain pending until a separate admin approval', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crossfire-ops-schedule-'));
  process.env.BOT_DATA_PATH = path.join(tempDir, 'bot-data.json');
  const store = await import(`../src/store.js?ops-schedule=${Date.now()}`);
  await store.saveScheduleProposal({
    id: 'ops-proposal',
    matchId: 'match-ops',
    scheduledAt: 'November 3, 2026 at 8:00 PM EST',
    proposedBy: 'ops-user',
    proposerTeam: 'ops',
    override: true,
    accepted: false
  });
  const accepted = await store.acceptScheduleProposal('ops-proposal', 'ops-user');
  assert.equal(accepted.accepted, true);
  assert.equal(Boolean(accepted.adminApproved), false);
  const approved = await store.approveScheduleProposal('ops-proposal', 'admin-user');
  assert.equal(approved.adminApproved, true);
  assert.equal(approved.approvedBy, 'admin-user');
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('duplicate active stream requests are rejected atomically per caster and match', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crossfire-stream-dedupe-'));
  process.env.BOT_DATA_PATH = path.join(tempDir, 'bot-data.json');
  const store = await import(`../src/store.js?dedupe=${Date.now()}`);
  const base = {
    requesterId: 'caster-1',
    matchId: 'match-1',
    faceitUrl: 'https://www.faceit.com/en/cs2/room/1-00000000-0000-0000-0000-000000000000'
  };
  const results = await Promise.all([
    store.createStreamRequestUnlessActive({ ...base, id: 'request-a' }),
    store.createStreamRequestUnlessActive({ ...base, id: 'request-b' })
  ]);
  assert.equal(results.filter((result) => result.created).length, 1);
  assert.equal((await store.listStreamRequests({ requesterId: 'caster-1' })).length, 1);
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

test('caster connection prompts are claimed once per approved match unless forced', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crossfire-delivery-'));
  process.env.BOT_DATA_PATH = path.join(tempDir, 'bot-data.json');
  const store = await import(`../src/store.js?delivery-a=${Date.now()}`);
  await store.createStreamRequest({ id: 'caster-1', requesterId: 'user-1', matchId: 'match-1', status: 'approved' });
  await store.createStreamRequest({ id: 'caster-2', requesterId: 'user-2', matchId: 'match-1', status: 'approved' });
  const [first, second] = await Promise.all([
    store.claimStreamDeliveryPrompt('match-1'),
    store.claimStreamDeliveryPrompt('match-1')
  ]);
  assert.equal([first, second].filter(Boolean).length, 1);
  assert.equal((await store.claimStreamDeliveryPrompt('match-1', true)).length, 2);
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
