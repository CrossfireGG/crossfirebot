import assert from 'node:assert/strict';
import test from 'node:test';

import { findOrCreateRole } from '../src/sheetRoles.js';

function makeGuild() {
  const oldRole = { id: '1532173602990981281', name: 'Addice' };
  const newRole = { id: '2000000000000000001', name: 'Addice' };
  const created = [];

  return {
    oldRole,
    newRole,
    created,
    guild: {
      roles: {
        cache: new Map([[oldRole.id, oldRole]]),
        async fetch(roleId) {
          if (roleId === oldRole.id) return oldRole;
          if (roleId === newRole.id) return newRole;
          return null;
        },
        async create(input) {
          created.push(input);
          return newRole;
        }
      }
    }
  };
}

test('new-season role creation ignores legacy ID mappings and same-name roles', async () => {
  const fixture = makeGuild();
  const config = {
    teamRoleIds: new Map([['addice', fixture.oldRole.id]])
  };

  const result = await findOrCreateRole(
    fixture.guild,
    'Addice',
    true,
    config,
    { forceCreate: true, reason: 'Season 7 role sync' }
  );

  assert.equal(result.created, true);
  assert.equal(result.role.id, fixture.newRole.id);
  assert.equal(fixture.created.length, 1);
  assert.equal(fixture.created[0].name, 'Addice');
});

test('later syncs reuse the role persisted for the current season', async () => {
  const fixture = makeGuild();
  const result = await findOrCreateRole(
    fixture.guild,
    'Addice',
    true,
    { teamRoleIds: new Map() },
    { preferredRoleId: fixture.newRole.id, forceCreate: false }
  );

  assert.equal(result.created, false);
  assert.equal(result.role.id, fixture.newRole.id);
  assert.equal(fixture.created.length, 0);
});
