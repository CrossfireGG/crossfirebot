import {
  ChannelType,
  PermissionFlagsBits
} from 'discord.js';

export async function provisionMatchChannel(guild, config, match) {
  const everyoneRole = guild.roles.everyone;
  const staffRole = config.discordStaffRoleId
    ? await guild.roles.fetch(config.discordStaffRoleId).catch(() => null)
    : null;
  const matchAccessRoles = await findOrCreateMatchAccessRoles(
    guild,
    config.matchAccessRoleIds,
    config.matchAccessRoleNames,
    config.createMissingTeamRoles
  );
  const privilegedRoles = [staffRole, ...matchAccessRoles].filter(Boolean);

  const teamARole = await findOrCreateTeamRole(guild, match.teamA, config.createMissingTeamRoles);
  const teamBRole = await findOrCreateTeamRole(guild, match.teamB, config.createMissingTeamRoles);

  if (!teamARole || !teamBRole) {
    const missing = [
      !teamARole ? match.teamA : null,
      !teamBRole ? match.teamB : null
    ].filter(Boolean);
    throw new Error(`Missing Discord role(s): ${missing.join(', ')}`);
  }

  const category = await findOrCreateCategory(guild, match.round, everyoneRole, privilegedRoles);
  const channelName = makeChannelName(`${match.teamA} vs ${match.teamB}`);
  const channel = await findOrCreateTextChannel(guild, category, channelName, [
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
  ], match);

  return {
    categoryId: category.id,
    channelId: channel.id,
    teamARoleId: teamARole.id,
    teamBRoleId: teamBRole.id
  };
}

async function findRoleByName(guild, name) {
  await guild.roles.fetch();
  return guild.roles.cache.find((role) => role.name.toLowerCase() === name.toLowerCase()) || null;
}

async function findOrCreateTeamRole(guild, name, shouldCreate) {
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
    const role = await findOrCreateTeamRole(guild, roleName, shouldCreate);
    if (role && !seen.has(role.id)) {
      roles.push(role);
      seen.add(role.id);
    }
  }

  return roles;
}

async function findOrCreateCategory(guild, roundName, everyoneRole, privilegedRoles) {
  const categoryName = `FACEIT - ${roundName}`;
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

async function findOrCreateTextChannel(guild, category, name, permissionOverwrites, match) {
  const existingInCategory = guild.channels.cache.find((channel) =>
    channel.parentId === category.id &&
    channel.type === ChannelType.GuildText &&
    channel.name.toLowerCase() === name.toLowerCase()
  );

  if (existingInCategory) {
    await existingInCategory.permissionOverwrites.set(permissionOverwrites);
    await updateChannelTopic(existingInCategory, match);
    return existingInCategory;
  }

  const existingAnywhere = guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildText &&
    channel.name.toLowerCase() === name.toLowerCase()
  );

  if (existingAnywhere) {
    await existingAnywhere.setParent(category.id, { lockPermissions: false });
    await existingAnywhere.permissionOverwrites.set(permissionOverwrites);
    await updateChannelTopic(existingAnywhere, match);
    return existingAnywhere;
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

function makeChannelName(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
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
