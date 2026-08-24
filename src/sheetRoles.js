import { getSheetTeamRoleIds, saveSheetTeamRoleIds } from './store.js';

export async function syncRolesFromSheet(guild, config, options = {}, onProgress = null) {
  if (!config.googleSheetCsvUrl) {
    throw new Error('GOOGLE_SHEET_CSV_URL is not configured');
  }

  await guild.roles.fetch();
  await guild.members.fetch().catch(() => null);

  const rows = await fetchCsvRows(config.googleSheetCsvUrl);
  const teamNames = rows
    .map((row) => getColumn(row, ['team_name', 'team name', 'team']))
    .filter(Boolean);
  const teamRoles = new Map();
  const previousTeamRoleIds = await getSheetTeamRoleIds(guild.id);
  const stats = {
    added: 0,
    rolesCreated: 0,
    participantAdded: 0,
    captainAdded: 0,
    nicknamesChanged: 0,
    skipped: 0,
    missingMembers: [],
    failedActions: [],
    captainDmsSent: 0,
    captainDmsFailed: 0
  };

  for (const teamName of teamNames) {
    const teamRoleResult = await findOrCreateRole(guild, teamName, config.createMissingTeamRoles);
    if (teamRoleResult.created) stats.rolesCreated += 1;
    if (teamRoleResult.role) teamRoles.set(teamName, teamRoleResult.role);
  }

  await saveSheetTeamRoleIds(guild.id, Object.fromEntries(
    [...teamRoles.entries()].map(([teamName, role]) => [teamName, role.id])
  ));

  for (const [index, row] of rows.entries()) {
    const teamName = getColumn(row, ['team_name', 'team name', 'team']);
    if (!teamName) {
      stats.skipped += 1;
      continue;
    }

    const teamRole = teamRoles.get(teamName);
    if (!teamRole) {
      stats.skipped += 1;
      continue;
    }

    const assignments = getTeamAssignments(row);
    if (!assignments.length) {
      stats.skipped += 1;
      continue;
    }

    const captainRoleResult = await findCaptainRole(guild, config);
    if (captainRoleResult.created) stats.rolesCreated += 1;
    const participantRoleResult = await findParticipantRole(guild, config);
    if (participantRoleResult.created) stats.rolesCreated += 1;

    const missingForTeam = [];
    const captainMembers = [];

    for (const assignment of assignments) {
      const member = await findMember(guild, assignment.discordName);
      if (!member) {
        stats.skipped += 1;
        stats.missingMembers.push(`${teamName}: ${assignment.discordName}`);
        missingForTeam.push(assignment.discordName);
        continue;
      }

      if (!member.roles.cache.has(teamRole.id)) {
        if (await addRole(member, teamRole, 'Google Sheet team role sync')) {
          stats.added += 1;
        } else {
          stats.failedActions.push(`${teamName}: could not add team role to ${assignment.discordName}`);
        }
      }

      await removeStaleTeamRoles(member, teamRoles, previousTeamRoleIds, teamName, stats);

      if (participantRoleResult.role && !member.roles.cache.has(participantRoleResult.role.id)) {
        if (await addRole(member, participantRoleResult.role, 'Google Sheet season participant sync')) {
          stats.participantAdded += 1;
        } else {
          stats.failedActions.push(`${teamName}: could not add participant role to ${assignment.discordName}`);
        }
      }

      if (assignment.isCaptain) {
        captainMembers.push(member);
        if (captainRoleResult.role && !member.roles.cache.has(captainRoleResult.role.id)) {
          if (await addRole(member, captainRoleResult.role, 'Google Sheet captain role sync')) {
            stats.captainAdded += 1;
          } else {
            stats.failedActions.push(`${teamName}: could not add captain role to ${assignment.discordName}`);
          }
        }
      }

      if (config.updateTeamNicknames) {
        const changed = await setTeamNickname(member, teamName);
        if (changed) stats.nicknamesChanged += 1;
      }
    }

    if (options.notifyCaptains && missingForTeam.length && captainMembers.length) {
      const sent = await dmCaptainsAboutMissingPlayers(captainMembers, teamName, missingForTeam);
      stats.captainDmsSent += sent.sent;
      stats.captainDmsFailed += sent.failed;
    }

    if (onProgress && ((index + 1) % 5 === 0 || index + 1 === rows.length)) {
      await onProgress({
        current: index + 1,
        total: rows.length,
        rolesCreated: stats.rolesCreated,
        added: stats.added,
        participantAdded: stats.participantAdded,
        captainAdded: stats.captainAdded,
        nicknamesChanged: stats.nicknamesChanged,
        skipped: stats.skipped
      });
    }
  }

  return {
    ...stats,
    missingMembers: stats.missingMembers.slice(0, 15),
    failedActions: stats.failedActions.slice(0, 10)
  };
}

export async function auditMissingCaptains(guild, config) {
  if (!config.googleSheetCsvUrl) {
    throw new Error('GOOGLE_SHEET_CSV_URL is not configured');
  }

  await guild.members.fetch().catch(() => null);

  const rows = await fetchCsvRows(config.googleSheetCsvUrl);
  const found = [];
  const missing = [];

  for (const row of rows) {
    const teamName = getColumn(row, ['team_name', 'team name', 'team']);
    if (!teamName) continue;

    const captainValue = getColumn(row, [
      'team_captain_discord_id',
      'team captain discord id',
      'team captain discord'
    ]);
    const captainIdentifiers = splitDiscordIdentifiers(captainValue);

    if (!captainIdentifiers.length) {
      missing.push({
        teamName,
        captain: '',
        reason: 'no captain listed in the sheet'
      });
      continue;
    }

    let matchedMember = null;
    for (const identifier of captainIdentifiers) {
      matchedMember = await findMember(guild, identifier);
      if (matchedMember) break;
    }

    if (matchedMember) {
      found.push({
        teamName,
        captain: captainIdentifiers.join(', '),
        memberId: matchedMember.id
      });
    } else {
      missing.push({
        teamName,
        captain: captainIdentifiers.join(', '),
        reason: 'not found in this Discord server'
      });
    }
  }

  return { found, missing, totalTeams: found.length + missing.length };
}

export async function auditMissingPlayers(guild, config) {
  if (!config.googleSheetCsvUrl) {
    throw new Error('GOOGLE_SHEET_CSV_URL is not configured');
  }

  await guild.members.fetch().catch(() => null);

  const rows = await fetchCsvRows(config.googleSheetCsvUrl);
  const teams = [];
  let foundPlayers = 0;
  let checkedPlayers = 0;

  for (const row of rows) {
    const teamName = getColumn(row, ['team_name', 'team name', 'team']);
    if (!teamName) continue;

    const assignments = getTeamAssignments(row);
    const missingPlayers = [];

    for (const assignment of assignments) {
      checkedPlayers += 1;
      const member = await findMember(guild, assignment.discordName);
      if (member) {
        foundPlayers += 1;
      } else {
        missingPlayers.push(assignment.discordName);
      }
    }

    if (missingPlayers.length) {
      teams.push({
        teamName,
        missingPlayers
      });
    }
  }

  return {
    teams,
    foundPlayers,
    checkedPlayers,
    missingPlayers: teams.reduce((total, team) => total + team.missingPlayers.length, 0)
  };
}

async function fetchCsvRows(url) {
  const response = await fetch(withCacheBust(url), {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache'
    }
  });
  if (!response.ok) {
    throw new Error(`Google Sheet CSV fetch failed: ${response.status}`);
  }

  const csv = await response.text();
  const records = parseCsv(csv);
  const headers = records.shift()?.map(normalizeHeader) || [];

  return records
    .filter((record) => record.some((value) => value.trim()))
    .map((record) => Object.fromEntries(
      headers.map((header, index) => [header, record[index]?.trim() || ''])
    ));
}

function withCacheBust(url) {
  const parsed = new URL(url);
  parsed.searchParams.set('_crossfire_sync', Date.now().toString());
  return parsed.toString();
}

function getColumn(row, names) {
  for (const name of names) {
    const value = row[normalizeHeader(name)];
    if (value) return value.trim();
  }

  return '';
}

function getTeamAssignments(row) {
  const assignments = [];

  for (const [header, value] of Object.entries(row)) {
    if (!isPlayerDiscordColumn(header) || !value) continue;

    const isCaptain = header.includes('captain');
    for (const discordName of splitDiscordIdentifiers(value)) {
      assignments.push({ discordName, isCaptain });
    }
  }

  return dedupeAssignments(assignments);
}

function isPlayerDiscordColumn(header) {
  const normalized = normalizeHeader(header);
  if (!normalized.includes('discord')) return false;

  const allowedPrefixes = [
    'team_captain',
    'starter_1',
    'starter_2',
    'starter_3',
    'starter_4',
    'starter_5',
    'substitute_1',
    'substitute_2',
    'coach'
  ];

  return allowedPrefixes.some((prefix) => normalized.startsWith(prefix));
}

function splitDiscordIdentifiers(value) {
  return String(value || '')
    .split(/[,|]+/)
    .map((part) => part.replace(/[<@!>]/g, '').replace(/^@/, '').trim())
    .filter((part) => part && !isPlaceholderDiscordValue(part));
}

function isPlaceholderDiscordValue(value) {
  return ['n/a', 'na', 'none', 'no', 'yes', '.', '-'].includes(
    String(value).trim().toLowerCase()
  );
}

function dedupeAssignments(assignments) {
  const byName = new Map();

  for (const assignment of assignments) {
    const key = normalizeMemberLookup(assignment.discordName);
    const existing = byName.get(key);
    byName.set(key, {
      discordName: assignment.discordName,
      isCaptain: Boolean(existing?.isCaptain || assignment.isCaptain)
    });
  }

  return [...byName.values()];
}

async function findOrCreateRole(guild, name, shouldCreate) {
  const existing = guild.roles.cache.find((role) =>
    role.name.toLowerCase() === name.toLowerCase()
  );

  if (existing) return { role: existing, created: false };
  if (!shouldCreate) return { role: null, created: false };

  const role = await guild.roles.create({
    name,
    mentionable: true,
    reason: 'Google Sheet role sync'
  });
  return { role, created: true };
}

async function findCaptainRole(guild, config) {
  if (config.teamCaptainRoleId) {
    const role = await guild.roles.fetch(config.teamCaptainRoleId).catch(() => null);
    if (role) return { role, created: false };
  }

  return findOrCreateRole(guild, config.teamCaptainRoleName, config.createMissingTeamRoles);
}

async function findParticipantRole(guild, config) {
  if (config.seasonParticipantRoleId) {
    const role = await guild.roles.fetch(config.seasonParticipantRoleId).catch(() => null);
    if (role) return { role, created: false };
  }

  return findOrCreateRole(guild, config.seasonParticipantRoleName, config.createMissingTeamRoles);
}

async function findMember(guild, identifier) {
  const cleaned = String(identifier || '').replace(/[<@!>]/g, '').replace(/^@/, '').trim();
  if (!cleaned) return null;

  if (/^\d{15,25}$/.test(cleaned)) {
    return guild.members.fetch(cleaned).catch(() => null);
  }

  const normalized = normalizeMemberLookup(cleaned);
  const cached = findCachedMember(guild, normalized);
  if (cached) return cached;

  const searched = await guild.members.search({ query: cleaned, limit: 10 }).catch(() => null);
  if (!searched) return null;

  const exact = searched.find((member) => memberMatches(member, normalized));
  return exact || null;
}

function findCachedMember(guild, normalized) {
  return guild.members.cache.find((member) => memberMatches(member, normalized)) || null;
}

function memberMatches(member, normalized) {
  return memberNameCandidates(member).some((candidate) =>
    normalizeMemberLookup(candidate) === normalized
  );
}

function memberNameCandidates(member) {
  return [
    member.user.username,
    member.user.globalName,
    member.displayName,
    member.nickname,
    `${member.user.username}#${member.user.discriminator}`
  ];
}

async function addRole(member, role, reason) {
  try {
    await member.roles.add(role, reason);
    return true;
  } catch {
    return false;
  }
}

async function removeStaleTeamRoles(member, teamRoles, previousTeamRoleIds, currentTeamName, stats) {
  const currentRole = teamRoles.get(currentTeamName);
  const managedRoles = new Map();

  for (const [teamName, role] of teamRoles.entries()) {
    managedRoles.set(role.id, teamName);
  }

  for (const [teamName, roleId] of Object.entries(previousTeamRoleIds || {})) {
    if (teamName === 'updatedAt') continue;
    managedRoles.set(roleId, teamName);
  }

  for (const [roleId, teamName] of managedRoles.entries()) {
    if (roleId === currentRole?.id || !member.roles.cache.has(roleId)) continue;

    try {
      await member.roles.remove(roleId, 'Removing stale Google Sheet team role');
    } catch {
      stats.failedActions.push(`${currentTeamName}: could not remove stale ${teamName} role from ${member.user.username}`);
    }
  }
}

async function setTeamNickname(member, teamName) {
  const baseName = member.user.globalName || member.user.username;
  const nextNickname = truncateNickname(`${teamName} | ${baseName}`);

  if (member.displayName === nextNickname) return false;

  try {
    await member.setNickname(nextNickname, 'Google Sheet team nickname sync');
    return true;
  } catch {
    return false;
  }
}

async function dmCaptainsAboutMissingPlayers(captains, teamName, missingPlayers) {
  const uniqueCaptains = [...new Map(captains.map((member) => [member.id, member])).values()];
  let sent = 0;
  let failed = 0;

  for (const captain of uniqueCaptains) {
    try {
      await captain.send([
        `Hey, I synced **${teamName}** from the Crossfire sheet, but I could not find these players in the Discord server:`,
        '',
        ...missingPlayers.map((player) => `- ${player}`),
        '',
        'Please invite them to the server or ask an admin to fix their Discord username/ID in the sheet.'
      ].join('\n'));
      sent += 1;
    } catch {
      failed += 1;
    }
  }

  return { sent, failed };
}

function truncateNickname(value) {
  if (value.length <= 32) return value;
  return value.slice(0, 31).trimEnd();
}

function normalizeMemberLookup(value) {
  return String(value || '')
    .replace(/[<@!>]/g, '')
    .replace(/^@/, '')
    .trim()
    .toLowerCase();
}

function normalizeHeader(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function parseCsv(csv) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
