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
import { applyServerBan, applyVetoAction, chooseFirstAction, chooseSide, createVeto, expectedVetoAction, markTurnTimedOut, parseMapPool, pauseVeto, undoVeto, vetoCanUndo, resumeVeto, turnLengthText, vetoActionLines, vetoFinalLines, vetoInProgress, vetoServerLines, vetoTurnExpired, vetoTurnText } from '../src/vetoEngine.js';
import {
  buildScheduleChangeNotice,
  classifyFaceitScheduleChange,
  formatEasternDateTimeInput,
  selectScheduleChangeRecipients,
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
  for (const map of mapPool.slice(0, 6)) {
    veto = applyVetoAction(veto, veto.currentTeam, map);
    if (veto.pendingSide) {
      assert.equal(veto.status, 'active', 'not complete until the last side is chosen');
      veto = chooseSide(veto, veto.pendingSide.team, 'T');
    }
  }
  assert.equal(veto.status, 'complete');
  assert.equal(veto.final.awardedMap, 'Train');
  assert.equal(veto.final.startingScore, '1-0 Bravo');
  assert.equal(vetoActionLines(veto).at(-1), '7. **Train** left over: awarded, not played (1-0 Bravo)');
  assert.equal(veto.final.playableMaps.length, 4);
  assert.equal(veto.final.maps.length, 4);
  assert.ok(veto.final.maps.every((entry) => entry.side === 'T' && !entry.knife), 'no knife round in the Grand Final: every map is a pick');
});

test('veto sides: the team that did not pick the map chooses its side; the decider is a knife round', () => {
  let veto = chooseFirstAction(createVeto({ match, mapPool, seeds: { teamA: 1, teamB: 8 }, format: 'bo3' }), 'teamA', 'self');
  veto = applyVetoAction(veto, 'teamA', 'Ancient'); // ban
  veto = applyVetoAction(veto, 'teamB', 'Anubis'); // ban
  assert.throws(() => chooseSide(veto, 'teamA', 'CT'), /no side to choose/);
  veto = applyVetoAction(veto, 'teamA', 'Mirage'); // pick
  assert.equal(expectedVetoAction(veto), 'side');
  assert.deepEqual(veto.pendingSide, { map: 'Mirage', team: 'teamB' });
  assert.match(vetoTurnText(veto), /^Bravo: choose your \*\*starting side\*\* on \*\*Mirage\*\*/);
  assert.throws(() => applyVetoAction(veto, 'teamB', 'Nuke'), /side on Mirage must be chosen first/);
  assert.throws(() => chooseSide(veto, 'teamA', 'CT'), /other team chooses the side/);
  assert.throws(() => chooseSide(veto, 'teamB', 'Middle'), /Invalid side/);
  veto = chooseSide(veto, 'teamB', 'CT');
  assert.equal(veto.currentTeam, 'teamB', 'the side chooser then makes their own pick');
  assert.equal(vetoActionLines(veto)[2], '3. **Alpha** pick Mirage (**Bravo** starts CT)');
  veto = applyVetoAction(veto, 'teamB', 'Nuke'); // pick
  veto = chooseSide(veto, 'teamA', 'T');
  veto = applyVetoAction(veto, 'teamA', 'Dust2'); // ban
  veto = applyVetoAction(veto, 'teamB', 'Inferno'); // ban
  assert.equal(veto.status, 'complete');
  assert.deepEqual(veto.final.playableMaps, ['Mirage', 'Nuke', 'Train']);
  assert.equal(veto.final.decider, 'Train');
  // The Actions list (veto message and the staff copy) ends with the decider.
  assert.equal(vetoActionLines(veto).length, 7);
  assert.equal(vetoActionLines(veto).at(-1), '7. **Train** decider (left over) · 🔪 knife round for sides');
  assert.deepEqual(vetoFinalLines(veto), [
    'Map 1: **Mirage** · Alpha pick · **Bravo** starts CT, Alpha starts T',
    'Map 2: **Nuke** · Bravo pick · **Alpha** starts T, Bravo starts CT',
    'Map 3: **Train** · decider · 🔪 **knife round** for sides',
    'Starting score: **0-0**'
  ]);
  // A veto finished before sides existed still prints.
  assert.deepEqual(vetoFinalLines({ teamA: 'Alpha', teamB: 'Bravo', final: { playableMaps: ['Mirage', 'Train'], decider: 'Train', startingScore: '0-0' } }), [
    'Map 1: **Mirage**', 'Map 2: **Train** · decider · 🔪 **knife round** for sides', 'Starting score: **0-0**'
  ]);
});

test('veto turn clock: 2 minutes per turn, restarted each turn, staff pause and resume', () => {
  const t0 = Date.parse('2026-11-17T01:40:00Z');
  const MIN = 60 * 1000;
  let veto = createVeto({ match, mapPool, seeds: { teamA: 1, teamB: 8 }, format: 'bo3', now: t0 });
  assert.equal(veto.turnSeconds, 120);
  assert.equal(turnLengthText(veto), '2 minutes');
  assert.equal(turnLengthText({ turnSeconds: 90 }), '90 seconds');
  assert.equal(veto.turnDeadlineAt, new Date(t0 + 2 * MIN).toISOString(), 'choosing who acts first is a timed turn too');
  assert.match(vetoTurnText(veto), new RegExp(`time runs out <t:${(t0 + 2 * MIN) / 1000}:R>`));
  assert.equal(vetoTurnExpired(veto, t0 + 2 * MIN - 1), false);
  assert.equal(vetoTurnExpired(veto, t0 + 2 * MIN), true);

  veto = chooseFirstAction(veto, 'teamA', 'self', t0 + MIN);
  assert.equal(veto.turnDeadlineAt, new Date(t0 + 3 * MIN).toISOString(), 'each turn gets a fresh 2 minutes');
  veto = applyVetoAction(veto, 'teamA', 'Ancient', t0 + MIN);
  veto = applyVetoAction(veto, 'teamB', 'Anubis', t0 + MIN);
  veto = applyVetoAction(veto, 'teamA', 'Mirage', t0 + 2 * MIN);
  assert.equal(veto.turnDeadlineAt, new Date(t0 + 4 * MIN).toISOString(), 'choosing a side is a timed turn');

  // Time runs out: reported once, nothing is chosen for the team, and they can still choose.
  assert.equal(vetoTurnExpired(veto, t0 + 5 * MIN), true);
  veto = markTurnTimedOut(veto, t0 + 5 * MIN);
  assert.equal(vetoTurnExpired(veto, t0 + 6 * MIN), false, 'only reported once');
  assert.match(vetoTurnText(veto), /Time is up/);
  assert.deepEqual(veto.pendingSide, { map: 'Mirage', team: 'teamB' });
  veto = chooseSide(veto, 'teamB', 'CT', t0 + 6 * MIN);
  assert.equal(veto.turnTimedOutAt, null);
  assert.equal(veto.turnDeadlineAt, new Date(t0 + 8 * MIN).toISOString());

  // Pause: the clock stops and nobody can choose. Resume: the full time again.
  assert.throws(() => resumeVeto(veto, t0 + 6 * MIN), /not paused/);
  veto = pauseVeto(veto, t0 + 7 * MIN);
  assert.equal(veto.turnDeadlineAt, null);
  assert.equal(vetoTurnExpired(veto, t0 + 60 * MIN), false, 'no timeout while paused');
  assert.match(vetoTurnText(veto), /Paused by staff/);
  assert.throws(() => applyVetoAction(veto, 'teamB', 'Nuke', t0 + 8 * MIN), /paused by staff/);
  assert.throws(() => pauseVeto(veto, t0 + 8 * MIN), /already paused/);
  veto = resumeVeto(veto, t0 + 30 * MIN);
  assert.equal(veto.pausedAt, null);
  assert.equal(veto.turnDeadlineAt, new Date(t0 + 32 * MIN).toISOString());
  assert.equal(veto.currentTeam, 'teamB', 'the same team is still up');

  veto = applyVetoAction(veto, 'teamB', 'Nuke', t0 + 31 * MIN);
  veto = chooseSide(veto, 'teamA', 'T', t0 + 31 * MIN);
  veto = applyVetoAction(veto, 'teamA', 'Dust2', t0 + 31 * MIN);
  veto = applyVetoAction(veto, 'teamB', 'Inferno', t0 + 31 * MIN);
  assert.equal(veto.status, 'complete');
  assert.equal(veto.turnDeadlineAt, null, 'no clock once it is over');
  assert.equal(vetoInProgress(veto), false);
  assert.throws(() => pauseVeto(veto), /not in progress/);

  // Starting again after a finished veto clears the old result (the store merges onto the old record).
  const again = { ...veto, ...createVeto({ match, mapPool, seeds: { teamA: 1, teamB: 8 }, format: 'bo3', now: t0 }) };
  assert.equal(again.final, null);
  assert.equal(again.pausedAt, null);
  assert.equal(again.status, 'choosing_first_action');
});

test('veto server location: after the maps, ban, ban, the one left over', () => {
  const serverPool = ['Chicago', 'Denver', 'Dallas'];
  let veto = createVeto({ match, mapPool, seeds: { teamA: 1, teamB: 8 }, format: 'bo3', serverPool });
  assert.deepEqual(vetoServerLines(veto), ['Left: Chicago, Denver, Dallas']);
  veto = chooseFirstAction(veto, 'teamA', 'opponent'); // Bravo acts first
  // Maps first.
  assert.equal(expectedVetoAction(veto), 'ban');
  assert.throws(() => applyServerBan(veto, 'teamB', 'Denver'), /maps are chosen first, then the server/);
  veto = applyVetoAction(veto, 'teamB', 'Ancient');
  veto = applyVetoAction(veto, 'teamA', 'Anubis');
  veto = chooseSide(applyVetoAction(veto, 'teamB', 'Mirage'), 'teamA', 'CT');
  veto = chooseSide(applyVetoAction(veto, 'teamA', 'Nuke'), 'teamB', 'T');
  veto = applyVetoAction(veto, 'teamB', 'Dust2');
  veto = applyVetoAction(veto, 'teamA', 'Inferno');
  // The maps are done, but the veto is not: the server location is next.
  assert.equal(veto.status, 'active');
  assert.equal(veto.final, null);
  assert.equal(expectedVetoAction(veto), 'server');
  assert.equal(veto.currentTeam, 'teamB', 'the team acting first bans a server first');
  assert.match(vetoTurnText(veto), /^Bravo: \*\*ban\*\* a server location\./);
  assert.ok(veto.turnDeadlineAt, 'server bans are timed turns');
  assert.throws(() => applyVetoAction(veto, 'teamB', 'Train'), /no remaining veto actions/);
  assert.throws(() => applyServerBan(veto, 'teamA', 'Denver'), /not your team/);
  veto = applyServerBan(veto, 'teamB', 'Denver');
  assert.equal(veto.server, null);
  assert.equal(veto.status, 'active');
  assert.throws(() => applyServerBan(veto, 'teamA', 'Denver'), /no longer available/);
  veto = applyServerBan(veto, 'teamA', 'Dallas');
  // The last server ban ends the veto.
  assert.equal(veto.server, 'Chicago');
  assert.equal(veto.status, 'complete');
  assert.equal(veto.turnDeadlineAt, null);
  assert.deepEqual(vetoServerLines(veto), ['1. **Bravo** ban Denver', '2. **Alpha** ban Dallas', 'Server: **Chicago**']);
  assert.deepEqual(vetoFinalLines(veto), [
    'Map 1: **Mirage** · Bravo pick · **Alpha** starts CT, Bravo starts T',
    'Map 2: **Nuke** · Alpha pick · **Bravo** starts T, Alpha starts CT',
    'Map 3: **Train** · decider · 🔪 **knife round** for sides',
    'Server: **Chicago**',
    'Starting score: **0-0**'
  ]);
  assert.throws(() => applyServerBan(veto, 'teamB', 'Chicago'), /no server location to ban/);
  // No locations configured: the veto ends with the last map, as before.
  let plain = chooseFirstAction(createVeto({ match, mapPool, seeds: { teamA: 1, teamB: 8 }, format: 'bo3' }), 'teamA', 'self');
  assert.equal(expectedVetoAction(plain), 'ban');
  assert.deepEqual(vetoServerLines(plain), []);
  plain = applyVetoAction(applyVetoAction(plain, 'teamA', 'Ancient'), 'teamB', 'Anubis');
  plain = chooseSide(applyVetoAction(plain, 'teamA', 'Mirage'), 'teamB', 'CT');
  plain = chooseSide(applyVetoAction(plain, 'teamB', 'Nuke'), 'teamA', 'T');
  plain = applyVetoAction(applyVetoAction(plain, 'teamA', 'Dust2'), 'teamB', 'Inferno');
  assert.equal(plain.status, 'complete');
  assert.throws(() => createVeto({ match, mapPool, seeds: { teamA: 1, teamB: 8 }, format: 'bo3', serverPool: ['Chicago', 'Chicago'] }), /must all be different/);
});

test('veto undo: staff take back one step at a time, down to the first choice', () => {
  const t0 = Date.parse('2026-11-17T01:40:00Z');
  const serverPool = ['Chicago', 'Denver', 'Dallas'];
  const start = createVeto({ match, mapPool, seeds: { teamA: 1, teamB: 8 }, format: 'bo3', serverPool, now: t0 });
  assert.equal(vetoCanUndo(start), false);
  assert.throws(() => undoVeto(start), /nothing to undo/);
  let veto = chooseFirstAction(start, 'teamA', 'self', t0);
  veto = applyVetoAction(veto, 'teamA', 'Ancient', t0);
  veto = applyVetoAction(veto, 'teamB', 'Anubis', t0);
  veto = applyVetoAction(veto, 'teamA', 'Mirage', t0);
  const beforeSide = veto;
  veto = chooseSide(veto, 'teamB', 'CT', t0);

  // Undo the side: back to choosing it, with a fresh clock.
  veto = undoVeto(veto, t0 + 60_000);
  assert.deepEqual(veto.pendingSide, beforeSide.pendingSide);
  assert.equal(veto.actions[2].side, undefined);
  assert.equal(veto.turnDeadlineAt, new Date(t0 + 180_000).toISOString());
  // Undo the pick: the map is available again and it is the picker's turn.
  veto = undoVeto(veto, t0);
  assert.equal(veto.pendingSide, null);
  assert.ok(veto.availableMaps.includes('Mirage'));
  assert.equal(veto.currentTeam, 'teamA');
  assert.equal(expectedVetoAction(veto), 'pick');
  // ...the two map bans and the first-action choice.
  veto = undoVeto(undoVeto(undoVeto(veto, t0), t0), t0);
  assert.equal(veto.status, 'choosing_first_action');
  assert.equal(veto.firstActionTeam, null);
  assert.equal(vetoCanUndo(veto), false);

  // Through to the end: maps, sides, then the server bans.
  let done = chooseFirstAction(start, 'teamA', 'self', t0);
  done = applyVetoAction(applyVetoAction(done, 'teamA', 'Ancient', t0), 'teamB', 'Anubis', t0);
  done = chooseSide(applyVetoAction(done, 'teamA', 'Mirage', t0), 'teamB', 'CT', t0);
  done = chooseSide(applyVetoAction(done, 'teamB', 'Nuke', t0), 'teamA', 'T', t0);
  done = applyVetoAction(applyVetoAction(done, 'teamA', 'Dust2', t0), 'teamB', 'Inferno', t0);
  done = applyServerBan(done, 'teamA', 'Denver', t0);
  // A paused veto stays paused when a step is undone.
  const paused = undoVeto(pauseVeto(done, t0), t0);
  assert.ok(paused.pausedAt);
  assert.equal(paused.turnDeadlineAt, null);
  assert.deepEqual(paused.availableServers, serverPool);
  done = applyServerBan(done, 'teamB', 'Dallas', t0);
  assert.equal(done.status, 'complete');
  assert.equal(done.server, 'Chicago');

  // A finished veto can be undone too (a wrong last click): the last server ban comes back.
  done = undoVeto(done, t0);
  assert.equal(done.status, 'active');
  assert.equal(done.final, null);
  assert.equal(done.server, null);
  assert.deepEqual(done.availableServers, ['Chicago', 'Dallas']);
  assert.equal(done.currentTeam, 'teamB');
  assert.ok(done.turnDeadlineAt);
  // ...then the first server ban, then the last map ban.
  done = undoVeto(done, t0);
  assert.equal(expectedVetoAction(done), 'server');
  assert.equal(done.currentTeam, 'teamA');
  done = undoVeto(done, t0);
  assert.equal(expectedVetoAction(done), 'ban');
  assert.equal(done.currentTeam, 'teamB');
  assert.ok(done.availableMaps.includes('Inferno'));
});

test('veto map pool typed by staff: seven different maps, commas or spaces', () => {
  assert.deepEqual(parseMapPool('Dust2 Mirage, Nuke, Ancient, Inferno, Anubis, Cache'), ['Dust2', 'Mirage', 'Nuke', 'Ancient', 'Inferno', 'Anubis', 'Cache']);
  assert.throws(() => parseMapPool('Dust2, Mirage, Nuke'), /exactly seven different maps \(got 3/);
  assert.throws(() => parseMapPool('Dust2 dust2 Nuke Ancient Inferno Anubis Cache'), /seven different maps/);
  assert.throws(() => parseMapPool(''), /got 0\)/);
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
    'AUTHORIZED_STAFF_ROLE_IDS',
    'TOURNAMENT_OPS_ROLE_IDS'
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
    delete process.env.TOURNAMENT_OPS_ROLE_IDS;
    assert.deepEqual(getConfig().authorizedStaffRoleIds, [
      '333333333333333',
      '444444444444444',
      '555555555555555',
      '666666666666666',
      '1474118305169019163'
    ]);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Tournament Operations role has full staff access by default', () => {
  const previous = Object.fromEntries([
    'DISCORD_TOKEN',
    'DISCORD_CLIENT_ID',
    'DISCORD_GUILD_ID',
    'FACEIT_API_KEY',
    'FACEIT_SOURCES',
    'AUTHORIZED_STAFF_ROLE_IDS',
    'DISCORD_STAFF_ROLE_ID',
    'ADMIN_ALERT_ROLE_IDS',
    'TOURNAMENT_OPS_ROLE_IDS'
  ].map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, {
      DISCORD_TOKEN: 'test-token',
      DISCORD_CLIENT_ID: '111111111111111',
      DISCORD_GUILD_ID: '222222222222222',
      FACEIT_API_KEY: 'test-key',
      FACEIT_SOURCES: 'championship:test-id:Test Championship'
    });
    for (const key of ['AUTHORIZED_STAFF_ROLE_IDS', 'DISCORD_STAFF_ROLE_ID', 'ADMIN_ALERT_ROLE_IDS', 'TOURNAMENT_OPS_ROLE_IDS']) delete process.env[key];
    const config = getConfig();
    assert.deepEqual(config.authorizedStaffRoleIds, ['1474118305169019163']);
    assert.equal(isAuthorizedStaffMember(fakeMember(['1474118305169019163']), config), true);
    assert.equal(isAuthorizedStaffMember(fakeMember(['999999999999999']), config), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Season 7 Group Stage window can be extended through November 11', () => {
  const previous = Object.fromEntries([
    'DISCORD_TOKEN',
    'DISCORD_CLIENT_ID',
    'DISCORD_GUILD_ID',
    'FACEIT_API_KEY',
    'FACEIT_SOURCES',
    'ROUND_WINDOWS'
  ].map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, {
      DISCORD_TOKEN: 'test-token',
      DISCORD_CLIENT_ID: '111111111111111',
      DISCORD_GUILD_ID: '222222222222222',
      FACEIT_API_KEY: 'test-key',
      FACEIT_SOURCES: 'championship:test-id:Test Championship',
      ROUND_WINDOWS: 'Group Stage=2026-11-02..2026-11-11;Group Stage - Round 3=2026-11-08..2026-11-11'
    });
    const windows = getConfig().roundWindows;
    assert.deepEqual(windows['group stage'], { start: '2026-11-02', end: '2026-11-11' });
    assert.deepEqual(windows['group stage - round 3'], { start: '2026-11-08', end: '2026-11-11' });
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

test('caster delivery accepts any staff connection message and validates Twitch links', () => {
  assert.equal(validateStreamDelivery('cstv', 'connect 123.45.67.89:27020').valid, true);
  assert.equal(
    validateStreamDelivery('cstv', 'password "examplepw123"; connect password "examplepw123"; connect 136.83.35.38:20001').valid,
    true
  );
  assert.equal(validateStreamDelivery('cstv', 'Use these lobby details and contact Tournament Ops if they fail.').valid, true);
  assert.equal(validateStreamDelivery('cstv', '   ').valid, false);
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

test('schedule changes go to each requesting caster once, never to anyone else', () => {
  const recipients = selectScheduleChangeRecipients([
    { id: 'a', requesterId: 'caster-1', status: 'pending' },
    { id: 'b', requesterId: 'caster-1', status: 'approved' },
    { id: 'c', requesterId: 'caster-2', status: 'pending' },
    { id: 'd', requesterId: 'caster-3', status: 'denied' },
    { id: 'e', status: 'approved' }
  ]);
  assert.deepEqual(recipients.map((request) => request.id), ['b', 'c']);
});

test('schedule change notices tell the caster what moved and what happened to their request', () => {
  const moved = buildScheduleChangeNotice({
    scheduleChange: 'rescheduled',
    matchup: 'Alpha vs Bravo',
    status: 'approved',
    previousLabel: 'November 2, 2026 8:00 PM ET',
    nextLabel: 'November 3, 2026 9:00 PM ET'
  });
  assert.match(moved, /Alpha vs Bravo\*\* moved from \*\*November 2, 2026 8:00 PM ET\*\* to \*\*November 3, 2026 9:00 PM ET/);
  assert.match(moved, /approved stream request has been updated/);
  assert.match(
    buildScheduleChangeNotice({ scheduleChange: 'rescheduled', matchup: 'Alpha vs Bravo', status: 'pending', previousLabel: 'x', nextLabel: 'y' }),
    /Your stream request has been updated to match/
  );
  assert.match(buildScheduleChangeNotice({ scheduleChange: 'unscheduled', matchup: 'Alpha vs Bravo', status: 'approved' }), /removed the scheduled time/);
  assert.match(buildScheduleChangeNotice({ scheduleChange: 'scheduled', matchup: 'Alpha vs Bravo', status: 'approved', nextLabel: 'y' }), /scheduled \*\*Alpha vs Bravo\*\* for \*\*y/);
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

test('the #FireCrown count goes up once per use and survives a restart', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crossfire-counter-'));
  process.env.BOT_DATA_PATH = path.join(tempDir, 'bot-data.json');
  const storeA = await import(`../src/store.js?counter-a=${Date.now()}`);
  assert.equal(await storeA.getCounter('fireCrown'), 0);
  const totals = await Promise.all([storeA.incrementCounter('fireCrown'), storeA.incrementCounter('fireCrown'), storeA.incrementCounter('fireCrown')]);
  assert.deepEqual(totals.sort(), [1, 2, 3], 'uses at the same moment are each counted');
  const storeB = await import(`../src/store.js?counter-b=${Date.now()}`);
  assert.equal(await storeB.getCounter('fireCrown'), 3);
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('relinking an existing channel migrates persistent match state to the new FACEIT ID', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crossfire-relink-'));
  process.env.BOT_DATA_PATH = path.join(tempDir, 'bot-data.json');
  const store = await import(`../src/store.js?relink=${Date.now()}`);
  await store.saveMatch({ id: 'old-match', teamA: 'Alpha', teamB: 'Bravo', faceitUrl: 'https://faceit/old' }, {
    channelId: 'channel-1',
    categoryId: 'round-old',
    introMessageId: 'intro-1'
  });
  await store.saveSchedule('old-match', { scheduledAt: 'November 3 8 PM ET', adminApproved: true });
  await store.saveScheduleProposal({ id: 'proposal-1', matchId: 'old-match', scheduledAt: 'November 3 8 PM ET' });
  await store.saveVeto({ matchId: 'old-match', status: 'active' });
  await store.createStreamRequest({
    id: 'stream-1',
    requesterId: 'caster-1',
    matchId: 'old-match',
    faceitUrl: 'https://faceit/old',
    matchup: 'Alpha vs Bravo'
  });

  await store.relinkMatchChannel({ id: 'new-match', teamA: 'Alpha', teamB: 'Bravo', faceitUrl: 'https://faceit/new' }, {
    channelId: 'channel-1',
    categoryId: 'round-new'
  });

  assert.equal(await store.getStoredMatch('old-match'), null);
  assert.equal((await store.getStoredMatch('new-match')).discord.introMessageId, 'intro-1');
  assert.equal((await store.getSchedule('new-match')).adminApproved, true);
  assert.equal((await store.getScheduleProposal('proposal-1')).matchId, 'new-match');
  assert.equal((await store.getVeto('new-match')).matchId, 'new-match');
  assert.equal((await store.getStreamRequest('stream-1')).faceitUrl, 'https://faceit/new');
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

test('a canceled schedule proposal cannot be accepted or recovered as open', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crossfire-cancel-proposal-'));
  process.env.BOT_DATA_PATH = path.join(tempDir, 'bot-data.json');
  const store = await import(`../src/store.js?cancel-proposal=${Date.now()}`);
  await store.saveScheduleProposal({
    id: 'proposal-cancel',
    matchId: 'match-cancel',
    scheduledAt: 'November 6, 2026 at 9:00 PM EST',
    proposedBy: 'team-user',
    proposerTeam: 'teamA',
    accepted: false
  });
  const canceled = await store.cancelScheduleProposal('proposal-cancel', 'team-user');
  assert.equal(canceled.canceled, true);
  assert.equal(canceled.canceledBy, 'team-user');
  assert.equal(await store.getLatestOpenScheduleProposalForMatch('match-cancel'), null);
  assert.equal(await store.acceptScheduleProposal('proposal-cancel', 'other-team-user'), null);
  assert.equal(await store.declineScheduleProposal('proposal-cancel', 'other-team-user'), null);
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('CROSSFIREBOT_API_KEY is preferred for website publishing', () => {
  const previous = Object.fromEntries([
    'DISCORD_TOKEN',
    'DISCORD_CLIENT_ID',
    'DISCORD_GUILD_ID',
    'FACEIT_API_KEY',
    'FACEIT_SOURCES',
    'WEBSITE_ENDPOINT',
    'WEBSITE_API_KEY',
    'CROSSFIREBOT_API_KEY'
  ].map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, {
      DISCORD_TOKEN: 'test-token',
      DISCORD_CLIENT_ID: '111111111111111',
      DISCORD_GUILD_ID: '222222222222222',
      FACEIT_API_KEY: 'test-key',
      FACEIT_SOURCES: 'championship:test-id:Test Championship',
      WEBSITE_ENDPOINT: 'https://example.com/api/caster-streams',
      WEBSITE_API_KEY: 'legacy-key',
      CROSSFIREBOT_API_KEY: 'crossfirebot-key'
    });
    assert.equal(getConfig().websiteApiKey, 'crossfirebot-key');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
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

test('CSTV connect lines are built from IP:PORT and get the season password', async () => {
  const { buildCstvConnect, wantsSeasonPassword, parseSeasonPassword } = await import('../src/streamRequest.js');
  assert.deepEqual(buildCstvConnect('66.206.17.130:27035', { password: 'pw1' }), {
    valid: true, value: 'password "pw1"; connect 66.206.17.130:27035', address: true, passwordAdded: true, passwordMissing: false
  });
  assert.equal(buildCstvConnect('connect 66.206.17.130:27035;', { password: 'pw1' }).value, 'password "pw1"; connect 66.206.17.130:27035');
  assert.equal(
    buildCstvConnect('password "313safafo2h13"; connect 136.83.35.38:20001', { password: 'pw1' }).value,
    'password "313safafo2h13"; connect 136.83.35.38:20001',
    'a full password-first line is sent as typed'
  );
  assert.equal(buildCstvConnect(' connect 66.206.17.130:27035 ', { password: 'pw1', usePassword: false }).value, 'connect 66.206.17.130:27035');
  const missing = buildCstvConnect('66.206.17.130:27035', { password: null });
  assert.equal(missing.value, 'connect 66.206.17.130:27035');
  assert.equal(missing.passwordMissing, true);
  assert.equal(buildCstvConnect('66.206.17.130', { password: 'pw1' }).valid, false, 'no port');
  assert.equal(buildCstvConnect('66.206.17:27035', { password: 'pw1' }).valid, false, 'short IP');
  assert.equal(buildCstvConnect('66.206.17.300:27035', { password: 'pw1' }).valid, false, 'octet over 255');
  assert.equal(buildCstvConnect('', { password: 'pw1' }).valid, false);
  const full = buildCstvConnect('connect 1.2.3.4:27015; password "other"', { password: 'pw1' });
  assert.equal(full.value, 'connect 1.2.3.4:27015; password "other"', 'a full line is sent as typed');
  assert.equal(full.address, false);
  assert.equal(buildCstvConnect('Use the lobby details from Tournament Ops', { password: 'pw1' }).value, 'Use the lobby details from Tournament Ops');
  assert.equal(wantsSeasonPassword('Yes'), true);
  assert.equal(wantsSeasonPassword(''), true);
  assert.equal(wantsSeasonPassword('no'), false);
  assert.equal(wantsSeasonPassword(' N '), false);
  assert.deepEqual(parseSeasonPassword('abc123'), { valid: true, value: 'abc123' });
  assert.deepEqual(parseSeasonPassword('none'), { valid: true, value: null });
  assert.equal(parseSeasonPassword('has space').valid, false);
  assert.equal(parseSeasonPassword('a"b').valid, false);
  // Staff can paste the whole line or a quoted password; only the password is kept.
  assert.deepEqual(parseSeasonPassword('password "313safafo2h13"; connect ip'), { valid: true, value: '313safafo2h13' });
  assert.deepEqual(parseSeasonPassword('password "313safafo2h13"; connect 136.83.35.38:20001'), { valid: true, value: '313safafo2h13' });
  assert.deepEqual(parseSeasonPassword('password 313safafo2h13'), { valid: true, value: '313safafo2h13' });
  assert.deepEqual(parseSeasonPassword('"313safafo2h13"'), { valid: true, value: '313safafo2h13' });
  assert.deepEqual(parseSeasonPassword('"313safafo2h13";'), { valid: true, value: '313safafo2h13' });
  assert.equal(parseSeasonPassword('password ""').valid, false);
});
