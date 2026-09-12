import {
  ChannelType,
  PermissionFlagsBits
} from 'discord.js';
import { makeBaseMatchChannelName, makeMatchChannelName } from './matchChannelName.js';

export { makeMatchChannelName } from './matchChannelName.js';

export async function provisionMatchChannel(guild, config, match) {
  const everyoneRole = guild.roles.everyone;
  const staffRole = config.discordStaffRoleId
    ? await guild.roles.fetch(config.discordStaffRoleId).catch(() => null)
    : null;
  const matchAccessRoles = await findOrCreateMatchAccessRoles(
    guild,
    config.matchAccessRoleIds,
    config.matchAccessRoleNames,
    false
  );
  const privilegedRoles = [staffRole, ...matchAccessRoles].filter(Boolean);

  const teamARole = await findOrCreateTeamRole(guild, config, match.teamA);
  const teamBRole = await findOrCreateTeamRole(guild, config, match.teamB);

  if (!teamARole || !teamBRole) {
    const missing = [
      !teamARole ? match.teamA : null,
      !teamBRole ? match.teamB : null
    ].filter(Boolean);
    throw new Error(`Missing Discord role(s): ${missing.join(', ')}`);
  }

  const category = await findOrCreateCategory(guild, config, match.categoryName || match.round, everyoneRole, privilegedRoles);
  const channelName = makeMatchChannelName(match);
  const channel = await findOrCreateTextChannel(
    guild,
    config,
    category,
    channelName,
    makeMatchPermissionOverwrites(everyoneRole, teamARole, teamBRole, privilegedRoles),
    match
  );

  return {
    categoryId: category.id,
    channelId: channel.id,
    teamARoleId: teamARole.id,
    teamBRoleId: teamBRole.id
  };
}

export async function repairMatchChannel(guild, config, channel, match) {
  const everyoneRole = guild.roles.everyone;
  const staffRole = config.discordStaffRoleId
    ? await guild.roles.fetch(config.discordStaffRoleId).catch(() => null)
    : null;
  const matchAccessRoles = await findOrCreateMatchAccessRoles(
    guild,
    config.matchAccessRoleIds,
    config.matchAccessRoleNames,
    false
  );
  const privilegedRoles = [staffRole, ...matchAccessRoles].filter(Boolean);
  const teamARole = await findOrCreateTeamRole(guild, config, match.teamA);
  const teamBRole = await findOrCreateTeamRole(guild, config, match.teamB);

  if (!teamARole || !teamBRole) {
    const missing = [
      !teamARole ? match.teamA : null,
      !teamBRole ? match.teamB : null
    ].filter(Boolean);
    throw new Error(`Missing Discord role(s): ${missing.join(', ')}`);
  }

  const category = await findOrCreateCategory(guild, config, match.categoryName || match.round, everyoneRole, privilegedRoles);
  if (channel.parentId !== category.id) {
    await channel.setParent(category.id, { lockPermissions: false });
  }
  await updateMatchChannelName(channel, match);
  await channel.permissionOverwrites.set(
    makeMatchPermissionOverwrites(everyoneRole, teamARole, teamBRole, privilegedRoles)
  );
  await updateChannelTopic(channel, match);

  return {
    categoryId: category.id,
    channelId: channel.id,
    teamARoleId: teamARole.id,
    teamBRoleId: teamBRole.id
  };
}

function makeMatchPermissionOverwrites(everyoneRole, teamARole, teamBRole, privilegedRoles) {
  return [
    {
      id: everyoneRole.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: teamARole.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
      ]
    },
    {
      id: teamBRole.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
      ]
    },
    ...privilegedRoles.map((role) => ({
      id: role.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages
      ]
    }))
  ];
}

export async function updateMatchChannelName(channel, match) {
  const nextName = makeMatchChannelName(match);
  return renameMatchChannel(channel, nextName);
}

async function renameMatchChannel(channel, nextName) {
  if (channel.name === nextName) {
    return { changed: false, name: channel.name };
  }

  try {
    const updated = await channel.setName(nextName);
    return { changed: true, name: updated.name };
  } catch (error) {
    console.error(`[Discord] failed to rename channel ${channel.id} from=${channel.name} to=${nextName}: ${error.message}`);
    return { changed: false, name: channel.name, error };
  }
}

async function findRoleByName(guild, name) {
  await guild.roles.fetch();
  return guild.roles.cache.find((role) => role.name.toLowerCase() === name.toLowerCase()) || null;
}

export async function resolveTeamRole(guild, config, name) {
  const mappedRoleId = config.teamRoleIds?.get(normalizeTeamKey(name));
  if (mappedRoleId) {
    const role = await guild.roles.fetch(mappedRoleId).catch(() => null);
    if (role) return role;
  }

  return findRoleByName(guild, name);
}

async function findOrCreateTeamRole(guild, config, name) {
  const shouldCreate = config.createMissingMatchTeamRoles;
  const mappedRoleId = config.teamRoleIds?.get(normalizeTeamKey(name));
  if (mappedRoleId) {
    const mappedRole = await guild.roles.fetch(mappedRoleId).catch(() => null);
    if (mappedRole) return mappedRole;
  }

  const existing = await findRoleByName(guild, name);
  if (existing || !shouldCreate) return existing;

  return guild.roles.create({
    name,
    mentionable: true,
    reason: 'FACEIT match channel permissions'
  });
}

async function findOrCreateMatchAccessRoles(guild, roleIds, roleNames, shouldCreate) {
  const roles = [];
  const seen = new Set();

  for (const roleId of roleIds) {
    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (role && !seen.has(role.id)) {
      roles.push(role);
      seen.add(role.id);
    }
  }

  for (const roleName of roleNames) {
    const role = await findOrCreateNamedRole(guild, roleName, shouldCreate);
    if (role && !seen.has(role.id)) {
      roles.push(role);
      seen.add(role.id);
    }
  }

  return roles;
}

async function findOrCreateNamedRole(guild, name, shouldCreate) {
  const existing = await findRoleByName(guild, name);
  if (existing || !shouldCreate) return existing;

  return guild.roles.create({
    name,
    mentionable: true,
    reason: 'FACEIT match channel permissions'
  });
}

async function findOrCreateCategory(guild, config, roundName, everyoneRole, privilegedRoles) {
  const categoryName = String(roundName || 'FACEIT Matches').slice(0, 100);
  const permissionOverwrites = [
    {
      id: everyoneRole.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    ...privilegedRoles.map((role) => ({
      id: role.id,
      allow: [PermissionFlagsBits.ViewChannel]
    }))
  ];
  const mappedCategoryId = config.roundCategoryIds?.get(normalizeTeamKey(roundName));
  const mappedCategory = mappedCategoryId ? guild.channels.cache.get(mappedCategoryId) : null;
  if (mappedCategory?.type === ChannelType.GuildCategory) {
    await mappedCategory.permissionOverwrites.set(permissionOverwrites);
    return mappedCategory;
  }

  const existing = guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildCategory &&
    channel.name.toLowerCase() === categoryName.toLowerCase()
  );

  if (existing) {
    await existing.permissionOverwrites.set(permissionOverwrites);
    return existing;
  }

  return guild.channels.create({
    name: categoryName,
    type: ChannelType.GuildCategory,
    permissionOverwrites
  });
}

async function findOrCreateTextChannel(guild, config, category, name, permissionOverwrites, match) {
  const existing = findExistingMatchChannel(guild, config, category, name, match);

  if (existing) {
    if (existing.name !== name) {
      await renameMatchChannel(existing, name);
    }
    if (existing.parentId !== category.id) {
      await existing.setParent(category.id, { lockPermissions: false });
    }
    await existing.permissionOverwrites.set(permissionOverwrites);
    await updateChannelTopic(existing, match);
    return existing;
  }

  const created = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites,
    topic: makeChannelTopic(match)
  });
  return created;
}

function findExistingMatchChannel(guild, config, category, name, match) {
  const mappedChannelId = config.matchChannelIds?.get(matchPairKey(match.teamA, match.teamB));
  const mappedChannel = mappedChannelId ? guild.channels.cache.get(mappedChannelId) : null;
  if (mappedChannel?.type === ChannelType.GuildText) return mappedChannel;

  const exactName = name.toLowerCase();
  const legacyName = makeChannelName(`${match.teamA} vs ${match.teamB}`).toLowerCase();
  const baseName = makeBaseMatchChannelName(match).toLowerCase();
  const faceitUrl = String(match.faceitUrl || '').toLowerCase();

  return guild.channels.cache.find((channel) => {
    if (channel.type !== ChannelType.GuildText) return false;

    const channelName = channel.name.toLowerCase();
    const unprefixedChannelName = stripMatchStatusPrefix(channelName);
    if (channel.parentId === category.id && channelName === exactName) return true;
    if (channelName === exactName || channelName === legacyName || unprefixedChannelName === baseName) return true;

    return faceitUrl && String(channel.topic || '').toLowerCase().includes(faceitUrl);
  }) || null;
}

function makeChannelName(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

function normalizeTeamKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function matchPairKey(teamA, teamB) {
  return [normalizeTeamKey(teamA), normalizeTeamKey(teamB)].sort().join('|');
}

async function updateChannelTopic(channel, match) {
  const topic = makeChannelTopic(match);
  if (channel.topic !== topic) {
    await channel.setTopic(topic).catch(() => null);
  }
}

function makeChannelTopic(match) {
  return [
    `Round: ${match.round}`,
    match.scheduledAt ? `FACEIT schedule: ${match.scheduledAt}` : 'FACEIT schedule: not set',
    match.faceitUrl ? `Room: ${match.faceitUrl}` : null
  ].filter(Boolean).join(' | ').slice(0, 1024);
}

function stripMatchStatusPrefix(value) {
  return String(value || '')
    .replace(/^(?:🟡|🟢|v)-/i, '')
    .replace(/^(?:scheduled|finished)-/i, '');
}
