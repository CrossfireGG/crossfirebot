import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes
} from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';

import { commands } from './commands.js';
import { getConfig } from './config.js';
import { FaceitClient } from './faceit.js';
import { makeMatchChannelName, provisionMatchChannel, resolveTeamRole, updateMatchChannelName } from './discordProvision.js';
import {
  acceptScheduleProposal,
  approveScheduleProposal,
  denyScheduleProposal,
  declineScheduleProposal,
  getLatestOpenScheduleProposalForMatch,
  getStoredMatch,
  getStoredMatchByChannel,
  listStoredMatches,
  saveMatch,
  saveMatchIntroMessageId,
  saveScheduleProposal
} from './store.js';
import { scheduleFaceitMatch } from './faceitSchedule.js';
import { auditMissingCaptains, auditMissingPlayers, syncRolesFromSheet } from './sheetRoles.js';

const config = getConfig();
const lockPath = path.resolve('bot.lock');
claimSingleInstance(lockPath);

const faceit = new FaceitClient(
  config.faceitApiKey,
  config.faceitSources
);

const SEASON_SCHEDULE = [
  { name: 'Group Stage', start: 'August 31, 2026', end: 'September 8, 2026', defaultDate: 'September 4, 2026' },
  { name: 'Round 1', start: 'August 31, 2026', end: 'September 2, 2026', defaultDate: 'September 1, 2026' },
  { name: 'Round 2', start: 'September 3, 2026', end: 'September 5, 2026', defaultDate: 'September 4, 2026' },
  { name: 'Round 3', start: 'September 6, 2026', end: 'September 8, 2026', defaultDate: 'September 7, 2026' },
  { name: 'Seeding Break', start: 'September 9, 2026', end: 'September 11, 2026', defaultDate: 'September 10, 2026' },
  { name: 'Playoff Stage', start: 'September 12, 2026', end: 'October 11, 2026', defaultDate: 'September 26, 2026' },
  { name: 'WB Round of 32', start: 'September 12, 2026', end: 'September 14, 2026', defaultDate: 'September 13, 2026' },
  { name: 'WB Round of 16 + Losers Round 1', start: 'September 15, 2026', end: 'September 17, 2026', defaultDate: 'September 16, 2026' },
  { name: 'WB Quarterfinals + Losers Round 2', start: 'September 18, 2026', end: 'September 20, 2026', defaultDate: 'September 19, 2026' },
  { name: 'Losers Round 3', start: 'September 21, 2026', end: 'September 23, 2026', defaultDate: 'September 22, 2026' },
  { name: 'WB Semifinals + Losers Round 4', start: 'September 24, 2026', end: 'September 26, 2026', defaultDate: 'September 25, 2026' },
  { name: 'Losers Round 5', start: 'September 27, 2026', end: 'September 29, 2026', defaultDate: 'September 28, 2026' },
  { name: 'WB Final + Losers Round 6', start: 'September 30, 2026', end: 'October 2, 2026', defaultDate: 'October 1, 2026' },
  { name: 'Losers Round 7', start: 'October 3, 2026', end: 'October 5, 2026', defaultDate: 'October 4, 2026' },
  { name: 'Losers Final', start: 'October 6, 2026', end: 'October 8, 2026', defaultDate: 'October 7, 2026' },
  { name: 'Grand Final (BO5)', start: 'October 9, 2026', end: 'October 11, 2026', defaultDate: 'October 10, 2026' }
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent
  ]
});

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
  console.log('Slash commands registered');
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (!canUseBotAdminCommand(interaction.member)) {
        await interaction.reply({ content: 'Only admins/match staff can use this bot command.', ephemeral: true });
        return;
      }

      await handleAdminCommand(interaction);

    }

    if (interaction.isButton() && interaction.customId.startsWith('schedule:')) {
      await handleDeprecatedScheduleInteraction(interaction);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('schedule_date:')) {
      await handleDeprecatedScheduleInteraction(interaction);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('schedule_time:')) {
      await handleDeprecatedScheduleInteraction(interaction);
    }

    if (interaction.isButton() && interaction.customId.startsWith('schedule_accept:')) {
      await handleDeprecatedScheduleInteraction(interaction);
    }

    if (interaction.isButton() && interaction.customId.startsWith('admin_schedule_approve:')) {
      await handleAdminScheduleDecision(interaction, true);
    }

    if (interaction.isButton() && interaction.customId.startsWith('admin_schedule_deny:')) {
      await handleAdminScheduleDecision(interaction, false);
    }
  } catch (error) {
    console.error(error);
    const message = `Something failed: ${error.message}`;
    await safelyRespondToInteraction(interaction, message);
  }
});

async function handleAdminCommand(interaction) {
  if (interaction.commandName === 'matches') {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'sync') {
      await handleSyncMatches(interaction);
      return;
    }

    if (subcommand === 'status') {
      const matches = await listStoredMatches();
      await interaction.reply({ content: `I know about ${matches.length} match(es).`, ephemeral: true });
      return;
    }

    if (subcommand === 'audit') {
      await handleAuditMatches(interaction);
      return;
    }

    if (subcommand === 'sample') {
      await handleSampleMatch(interaction);
      return;
    }
  }

  if (interaction.commandName === 'teams') {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'sync') {
      await handleSyncTeamRoles(interaction);
      return;
    }

    if (subcommand === 'missing-captains') {
      await handleMissingCaptains(interaction);
      return;
    }

    if (subcommand === 'missing-players') {
      await handleMissingPlayers(interaction);
      return;
    }
  }

  await interaction.reply({ content: 'Unknown command.', ephemeral: true });
}

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot || !message.guild) return;

    const content = message.content.trim();
    if (!content.startsWith('!')) return;

    if (content.toLowerCase().startsWith('!schedule')) {
      await handleTextScheduleProposal(message, content, 'schedule');
    }

    if (content.toLowerCase().startsWith('!propose')) {
      await handleTextScheduleProposal(message, content, 'schedule');
    }

    if (content.toLowerCase().startsWith('!reschedule')) {
      await handleTextScheduleProposal(message, content, 'reschedule');
    }

    if (content.toLowerCase() === '!accept') {
      await handleTextAccept(message);
    }

    if (content.toLowerCase() === '!decline') {
      await handleTextDecline(message);
    }

    if (content.toLowerCase().startsWith('!calladmin')) {
      await handleCallAdmin(message, content);
    }
  } catch (error) {
    console.error(error);
    await message.reply(`Something failed: ${error.message}`);
  }
});

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  await rest.put(
    Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId),
    { body: commands }
  );
}

async function handleSyncMatches(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const requestedRound = interaction.options.getInteger('round') || 0;

  const guild = await client.guilds.fetch(config.discordGuildId);
  await guild.channels.fetch();
  await guild.roles.fetch();

  const allMatches = await faceit.getMatches();
  const matches = filterAndSortMatchesForSync(allMatches, requestedRound);
  let created = 0;
  let skipped = 0;

  for (const match of matches) {
    if (!match.teamA || !match.teamB) {
      skipped += 1;
      continue;
    }

    const discordIds = await provisionMatchChannel(guild, config, match);
    await saveMatch(match, discordIds);

    const channel = await guild.channels.fetch(discordIds.channelId);
    await upsertMatchIntroMessage(channel, match);

    created += 1;
  }

  const roundText = requestedRound
    ? `Group Stage - Round ${requestedRound}`
    : 'all detected rounds';
  const coverage = summarizeSyncCoverage(matches);
  await interaction.editReply([
    `Synced ${created} match channel(s) for ${roundText}. Skipped ${skipped}.`,
    coverage
  ].filter(Boolean).join('\n'));
}

async function handleAuditMatches(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const requestedRound = interaction.options.getInteger('round') || 0;
  const shouldFix = interaction.options.getBoolean('fix') || false;
  const guild = await client.guilds.fetch(config.discordGuildId);
  await guild.channels.fetch();
  await guild.roles.fetch();

  const matches = filterAndSortMatchesForSync(await faceit.getMatches(), requestedRound);
  const result = {
    checked: 0,
    ok: 0,
    missingChannel: 0,
    missingRoles: 0,
    badPermissions: 0,
    fixed: 0,
    problems: []
  };

  for (const match of matches) {
    result.checked += 1;
    const audit = await auditMatchProvisioning(guild, match);
    const hasProblem = audit.problems.length > 0;

    if (!hasProblem) {
      result.ok += 1;
      continue;
    }

    if (audit.missingChannel) result.missingChannel += 1;
    if (audit.missingRoles.length) result.missingRoles += 1;
    if (audit.badPermissions.length) result.badPermissions += 1;

    if (shouldFix) {
      try {
        const discordIds = await provisionMatchChannel(guild, config, match);
        await saveMatch(match, discordIds);
        const channel = await guild.channels.fetch(discordIds.channelId);
        await upsertMatchIntroMessage(channel, match);
        result.fixed += 1;
      } catch (error) {
        result.problems.push(`${match.teamA} vs ${match.teamB}: fix failed - ${error.message}`);
      }
    } else {
      result.problems.push(`${match.teamA} vs ${match.teamB}: ${audit.problems.join('; ')}`);
    }
  }

  const roundText = requestedRound
    ? `Group Stage - Round ${requestedRound}`
    : 'all detected rounds';
  const maxProblemLines = 6;
  const problemLines = result.problems
    .slice(0, maxProblemLines)
    .map((problem) => `- ${truncateText(problem, 180)}`);
  const hiddenCount = Math.max(0, result.problems.length - problemLines.length);

  await interaction.editReply(truncateDiscordMessage([
    `${shouldFix ? 'Audited/fixed' : 'Audited'} ${result.checked} match(es) for ${roundText}.`,
    `OK: ${result.ok}. Missing channels: ${result.missingChannel}. Missing mapped roles: ${result.missingRoles}. Bad permissions: ${result.badPermissions}. Fixed: ${result.fixed}.`,
    problemLines.length ? ['Problems:', ...problemLines].join('\n') : null,
    hiddenCount ? `...and ${hiddenCount} more problem(s).` : null,
    shouldFix ? 'Run `/matches audit` again without fix to verify everything is clean.' : 'Use `/matches audit fix:true` to repair channel names, links, and permissions without intentionally duplicating existing match rooms.'
  ].filter(Boolean).join('\n')));
}

async function auditMatchProvisioning(guild, match) {
  const expectedName = makeMatchChannelName(match);
  const channel = findAuditMatchChannel(guild, match, expectedName);
  const teamARole = await resolveTeamRole(guild, config, match.teamA);
  const teamBRole = await resolveTeamRole(guild, config, match.teamB);
  const requiredAccessRoleIds = [
    teamARole?.id,
    teamBRole?.id,
    ...config.matchAccessRoleIds
  ].filter(Boolean);
  const problems = [];
  const badPermissions = [];

  if (!teamARole) problems.push(`missing role mapping for ${match.teamA}`);
  if (!teamBRole) problems.push(`missing role mapping for ${match.teamB}`);

  if (!channel) {
    problems.push(`missing channel ${expectedName}`);
    return {
      problems,
      missingChannel: true,
      missingRoles: [!teamARole ? match.teamA : null, !teamBRole ? match.teamB : null].filter(Boolean),
      badPermissions
    };
  }

  if (channel.name !== expectedName) {
    problems.push(`wrong channel name ${channel.name}, expected ${expectedName}`);
  }

  const everyoneOverwrite = channel.permissionOverwrites.cache.get(guild.roles.everyone.id);
  if (!everyoneOverwrite?.deny.has(PermissionFlagsBits.ViewChannel)) {
    badPermissions.push('@everyone hidden');
  }

  for (const roleId of requiredAccessRoleIds) {
    const overwrite = channel.permissionOverwrites.cache.get(roleId);
    if (!overwrite?.allow.has(PermissionFlagsBits.ViewChannel)) {
      badPermissions.push(`<@&${roleId}> view`);
    }
    if (!overwrite?.allow.has(PermissionFlagsBits.SendMessages)) {
      badPermissions.push(`<@&${roleId}> send`);
    }
    if (!overwrite?.allow.has(PermissionFlagsBits.ReadMessageHistory)) {
      badPermissions.push(`<@&${roleId}> history`);
    }
  }

  for (const roleId of config.matchAccessRoleIds) {
    const overwrite = channel.permissionOverwrites.cache.get(roleId);
    if (!overwrite?.allow.has(PermissionFlagsBits.ManageMessages)) {
      badPermissions.push(`<@&${roleId}> manage messages`);
    }
  }

  if (badPermissions.length) {
    problems.push(`bad permissions: ${badPermissions.join(', ')}`);
  }

  return {
    problems,
    missingChannel: false,
    missingRoles: [!teamARole ? match.teamA : null, !teamBRole ? match.teamB : null].filter(Boolean),
    badPermissions
  };
}

function findAuditMatchChannel(guild, match, expectedName) {
  const normalizedExpected = normalizeDiscordChannelName(stripMatchStatusPrefix(expectedName));
  const faceitUrl = String(match.faceitUrl || '').toLowerCase();
  const matchId = String(match.id || '').toLowerCase();

  return guild.channels.cache.find((channel) => {
    if (!channel.isTextBased?.() || !channel.permissionOverwrites?.cache) return false;

    const channelName = normalizeDiscordChannelName(stripMatchStatusPrefix(channel.name));
    if (channelName === normalizedExpected) return true;

    const topic = String(channel.topic || '').toLowerCase();
    return (matchId && topic.includes(matchId)) || (faceitUrl && topic.includes(faceitUrl));
  }) || null;
}

function filterAndSortMatchesForSync(matches, requestedRound) {
  return matches
    .filter((match) => {
      if (!requestedRound) return true;
      return getGroupStageRoundNumber(match) === requestedRound;
    })
    .sort(compareMatchesForChannelOrder);
}

function compareMatchesForChannelOrder(a, b) {
  return getGroupStageRoundNumber(a) - getGroupStageRoundNumber(b) ||
    getGroupSortIndex(a) - getGroupSortIndex(b) ||
    String(a.teamA || '').localeCompare(String(b.teamA || ''), undefined, { sensitivity: 'base' }) ||
    String(a.teamB || '').localeCompare(String(b.teamB || ''), undefined, { sensitivity: 'base' });
}

function getGroupStageRoundNumber(match) {
  const categoryMatch = String(match.categoryName || match.round || '').match(/\b(?:group stage\s*-\s*round|round)\s*(\d+)(?:\s+group stage)?\b/i);
  if (categoryMatch) return Number(categoryMatch[1]);

  const rawRound = Number(match.raw?.round_number ?? match.raw?.round);
  return [1, 2, 3].includes(rawRound) ? rawRound : 999;
}

function getGroupSortIndex(match) {
  const letterMatch = String(match.group || '').match(/\bgroup\s*([a-z]+)\b/i);
  if (letterMatch) return lettersToNumber(letterMatch[1]);

  const rawGroup = Number(match.raw?.group ?? match.raw?.group_number);
  return Number.isInteger(rawGroup) && rawGroup > 0 ? rawGroup : 999;
}

function lettersToNumber(value) {
  return String(value || '')
    .toUpperCase()
    .split('')
    .reduce((total, char) => {
      const code = char.charCodeAt(0);
      if (code < 65 || code > 90) return total;
      return total * 26 + code - 64;
    }, 0) || 999;
}

function summarizeSyncCoverage(matches) {
  const grouped = new Map();

  for (const match of matches) {
    if (!isGroupStageMatch(match)) continue;

    const round = getGroupStageRoundNumber(match);
    const group = getGroupLetterForMatch(match);
    if (!round || round === 999 || !group) continue;

    if (!grouped.has(round)) grouped.set(round, new Set());
    grouped.get(round).add(group);
  }

  if (!grouped.size) return '';

  return [...grouped.entries()]
    .sort(([roundA], [roundB]) => roundA - roundB)
    .map(([round, groups]) => {
      const sortedGroups = [...groups].sort((a, b) => lettersToNumber(a) - lettersToNumber(b));
      const missingGroups = expectedGroupLetters()
        .filter((group) => !groups.has(group));
      const missingText = missingGroups.length
        ? ` Missing groups: ${missingGroups.join(', ')}.`
        : ' All groups A-L detected.';
      return `Group Stage - Round ${round}: groups ${sortedGroups.join(', ')}.${missingText}`;
    })
    .join('\n');
}

function expectedGroupLetters() {
  return Array.from({ length: 12 }, (_, index) => String.fromCharCode(65 + index));
}

function numberToLetters(value) {
  let number = value;
  let letters = '';

  while (number > 0) {
    number -= 1;
    letters = String.fromCharCode(65 + (number % 26)) + letters;
    number = Math.floor(number / 26);
  }

  return letters;
}

function getGroupLetterForMatch(match) {
  const groupText = String(match.group || '');
  const groupNameMatch = groupText.match(/\bgroup\s*([a-z]+)\b/i);
  if (groupNameMatch) return groupNameMatch[1].toUpperCase();

  const rawGroup = Number(match.raw?.group ?? match.raw?.group_number);
  if (Number.isInteger(rawGroup) && rawGroup > 0) {
    return numberToLetters(rawGroup);
  }

  const fallback = groupText.match(/[a-z]+/i);
  return fallback ? fallback[0].toUpperCase() : '';
}

async function handleSampleMatch(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const guild = await client.guilds.fetch(config.discordGuildId);
  await guild.channels.fetch();
  await guild.roles.fetch();

  const match = buildSampleMatch(interaction);
  const discordIds = await provisionMatchChannel(guild, config, match);
  await saveMatch(match, discordIds);

  const channel = await guild.channels.fetch(discordIds.channelId);
  await upsertMatchIntroMessage(channel, match);

  await interaction.editReply([
    `Created sample match chat: <#${channel.id}>`,
    `Channel name should be \`${channel.name}\`.`,
    `Team test: give yourself one sample team role, give another person the other sample team role, then test \`!propose Tuesday 8 PM EST\` and \`!accept\`.`,
    `Tournament Ops test: give yourself the Tournament Ops role, then test \`!schedule Tuesday 8 PM EST\` without \`!accept\`.`
  ].join('\n'));
}

function buildSampleMatch(interaction) {
  const groupLetter = normalizeGroupLetter(interaction.options.getString('group') || 'A');
  const teamA = cleanSampleName(interaction.options.getString('team_a') || 'Sample Team One');
  const teamB = cleanSampleName(interaction.options.getString('team_b') || 'Sample Team Two');
  const roundNumber = normalizeGroupStageRound(interaction.options.getInteger('round') || 1);
  const categoryName = `Group Stage - Round ${roundNumber}`;

  return {
    id: `sample:${interaction.guildId}:${groupLetter}:${slugForId(teamA)}:${slugForId(teamB)}`,
    status: 'sample',
    round: categoryName,
    group: `Group ${groupLetter}`,
    categoryName,
    source: {
      type: 'sample',
      id: 'sample',
      name: 'Group Stage - Sample'
    },
    teamA,
    teamB,
    faceitUrl: null,
    scheduledAt: null,
    raw: {
      round: roundNumber,
      group: groupLetter
    }
  };
}

function normalizeGroupLetter(value) {
  const match = String(value || 'A').trim().match(/[a-z]/i);
  return match ? match[0].toUpperCase() : 'A';
}

function normalizeGroupStageRound(value) {
  return [1, 2, 3].includes(Number(value)) ? Number(value) : 1;
}

function cleanSampleName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80) || 'Sample Team';
}

function slugForId(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

async function handleSyncTeamRoles(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const notifyCaptains = interaction.options.getBoolean('notify_captains') || false;
  await interaction.editReply(
    `Started syncing team roles from Google Sheet... Captain DMs: **${notifyCaptains ? 'on' : 'off'}**.`
  );

  const guild = await client.guilds.fetch(config.discordGuildId);
  let lastProgressAt = 0;
  const result = await syncRolesFromSheet(
    guild,
    config,
    { notifyCaptains },
    async (progress) => {
      const now = Date.now();
      if (now - lastProgressAt < 2500 && progress.current !== progress.total) return;
      lastProgressAt = now;

      await interaction.editReply(
        `Syncing team roles... ${progress.current}/${progress.total} teams checked. Created ${progress.rolesCreated} role(s), added ${progress.added} team role assignment(s), ${progress.participantAdded} participant assignment(s), ${progress.captainAdded} captain assignment(s), removed ${progress.removed} stale role assignment(s). Captain DMs: **${notifyCaptains ? 'on' : 'off'}**.`
      ).catch(() => null);
    }
  );

  const missingLine = result.missingMembers?.length
    ? `\nCould not find these Discord users: ${result.missingMembers.join(', ')}`
    : '';
  const failedLine = result.failedActions?.length
    ? `\nCould not complete these actions: ${result.failedActions.join(', ')}`
    : '';

  await interaction.editReply(
    `Synced team roles from Google Sheet. Created ${result.rolesCreated} role(s), added ${result.added} team role assignment(s), ${result.participantAdded} season participant assignment(s), ${result.captainAdded} captain role assignment(s), removed ${result.removed} stale role assignment(s), changed ${result.nicknamesChanged} nickname(s), sent ${result.captainDmsSent} captain DM(s). Skipped ${result.skipped}.${missingLine}${failedLine}`
  );
}

async function handleMissingCaptains(interaction) {
  await interaction.deferReply({ ephemeral: true });
  await interaction.editReply('Checking the Google Sheet for missing team captains...');

  const guild = await client.guilds.fetch(config.discordGuildId);
  const result = await auditMissingCaptains(guild, config);
  const missing = result.missing.slice(0, 30);
  const moreCount = Math.max(0, result.missing.length - missing.length);
  const missingLines = missing.map((entry) => {
    const captain = entry.captain ? ` (${entry.captain})` : '';
    return `- ${entry.teamName}${captain}: ${entry.reason}`;
  });

  const body = missingLines.length
    ? ['Missing captains:', ...missingLines].join('\n')
    : 'No missing captains found. Every listed captain matched a Discord member.';
  const moreLine = moreCount
    ? `\n...and ${moreCount} more.`
    : '';

  await interaction.editReply(
    `Captain audit complete. Found ${result.found.length}/${result.totalTeams} captain(s). Missing ${result.missing.length}.\n${body}${moreLine}`
  );
}

async function handleMissingPlayers(interaction) {
  await interaction.deferReply({ ephemeral: true });
  await interaction.editReply('Checking the Google Sheet for players missing from Discord...');

  const guild = await client.guilds.fetch(config.discordGuildId);
  const result = await auditMissingPlayers(guild, config);
  const lines = [];
  let shownPlayers = 0;
  const maxPlayersToShow = 60;

  for (const team of result.teams) {
    if (shownPlayers >= maxPlayersToShow) break;

    const remainingSlots = maxPlayersToShow - shownPlayers;
    const players = team.missingPlayers.slice(0, remainingSlots);
    shownPlayers += players.length;
    lines.push(`**${team.teamName}**: ${players.join(', ')}`);
  }

  const body = lines.length
    ? lines.join('\n')
    : 'No missing players found. Every listed player matched a Discord member.';
  const hiddenCount = Math.max(0, result.missingPlayers - shownPlayers);
  const hiddenLine = hiddenCount
    ? `\n...and ${hiddenCount} more missing player(s).`
    : '';

  await interaction.editReply(
    `Missing player audit complete. Found ${result.foundPlayers}/${result.checkedPlayers} listed player(s). Missing ${result.missingPlayers} across ${result.teams.length} team(s).\n${body}${hiddenLine}`
  );
}

async function handleTextScheduleProposal(message, content, kind) {
  const stored = await getStoredMatchForChannel(message.channel);
  if (!stored) {
    await message.reply(await buildUnlinkedMatchChannelMessage(message.channel, [
      kind === 'reschedule'
        ? 'Use `!reschedule` inside a match channel created by the bot.'
        : 'Use `!schedule` or `!propose` inside a match channel created by the bot.',
      'If this should be a match room, run `/matches audit fix:true` to repair missing links, names, and permissions.'
    ]));
    return;
  }

  const member = await message.guild.members.fetch(message.author.id);
  const proposerTeam = getMemberTeam(member, stored.discord);
  const canScheduleDirectly = hasScheduleOverride(member);
  if (!proposerTeam && !canScheduleDirectly) {
    await message.reply('Only a member from one of the two teams can propose a schedule. Tournament Ops can schedule it directly.');
    return;
  }

  const proposedText = content.replace(/^!(schedule|propose|reschedule)\s*/i, '').trim();
  if (!proposedText) {
    await message.reply(`Use it like this: \`!${kind === 'reschedule' ? 'reschedule' : 'schedule'} 8/24/2026 3 PM EST\` or \`!${kind === 'reschedule' ? 'reschedule' : 'schedule'} Tuesday 8 PM ET\``);
    return;
  }

  const parsedSchedule = parseScheduleInput(proposedText);
  const validation = validateScheduleRequest(stored, proposedText, kind, parsedSchedule?.date || null);
  if (!validation.allowed) {
    await message.reply(validation.message);
    return;
  }
  const scheduledAt = parsedSchedule?.display || proposedText;

  const proposalId = makeProposalId();
  const proposal = {
    id: proposalId,
    matchId: stored.match.id,
    scheduledAt,
    scheduledAtIso: parsedSchedule?.iso || null,
    timezone: parsedSchedule?.timeZone || config.defaultTimezone,
    timezoneInput: parsedSchedule?.timeZoneInput || null,
    proposedBy: message.author.id,
    proposerTeam: proposerTeam || 'ops',
    accepted: false,
    kind,
    source: 'text',
    validation,
    override: canScheduleDirectly
  };

  await saveScheduleProposal(proposal);

  if (canScheduleDirectly) {
    const faceitLine = await applyAcceptedSchedule(message.channel, stored, proposal, message.author.id);
    await message.channel.send([
      `**${kind === 'reschedule' ? 'Reschedule' : 'Schedule'} set by Tournament Ops:** ${stored.match.teamA} vs ${stored.match.teamB}`,
      `Time: **${formatProposalTime(proposal)}**`,
      faceitRoomLine(stored.match),
      `Set by: <@${message.author.id}>`,
      validation.warning ? `Warning: **${validation.warning}**` : null,
      faceitLine
    ].filter(Boolean).join('\n'));
    await notifyAdmins(message.guild, stored, proposal, message.author.id, faceitLine);
    return;
  }

  const otherTeam = proposerTeam === 'teamA' ? 'teamB' : 'teamA';
  const otherRoleId = otherTeam === 'teamA'
    ? stored.discord.teamARoleId
    : stored.discord.teamBRoleId;

  await message.channel.send([
    `<@&${otherRoleId}>`,
    `**${kind === 'reschedule' ? 'Reschedule' : 'Schedule'} proposed:** ${stored.match.teamA} vs ${stored.match.teamB}`,
    `Time: **${scheduledAt}**${parsedSchedule?.discordTimestamp ? ` (${parsedSchedule.discordTimestamp})` : ''}`,
    faceitRoomLine(stored.match),
    `Proposed by: <@${message.author.id}>`,
    validation.warning ? `Warning: **${validation.warning}**` : null,
    'Other team: type `!accept` or `!decline` to confirm.'
  ].filter(Boolean).join('\n'));
}

async function handleTextAccept(message) {
  const stored = await getStoredMatchForChannel(message.channel);
  if (!stored) {
    await message.reply(await buildUnlinkedMatchChannelMessage(message.channel, [
      'Use `!accept` inside a match channel created by the bot.',
      'If this is a match room, run `/matches audit fix:true` so I can relink it.'
    ]));
    return;
  }

  const proposal = await getLatestOpenScheduleProposalForMatch(stored.match.id);
  if (!proposal) {
    await message.reply('There is no open schedule proposal for this match.');
    return;
  }

  const member = await message.guild.members.fetch(message.author.id);
  const memberTeam = getMemberTeam(member, stored.discord);
  const otherTeam = proposal.proposerTeam === 'teamA' ? 'teamB' : 'teamA';
  if (memberTeam !== otherTeam) {
    await message.reply('Only a member from the other team can accept this schedule.');
    return;
  }

  const faceitLine = await applyAcceptedSchedule(message.channel, stored, proposal, message.author.id);

  await message.channel.send([
    `**${proposal.kind === 'reschedule' ? 'Reschedule' : 'Schedule'} accepted:** ${stored.match.teamA} vs ${stored.match.teamB}`,
    `Time: **${formatProposalTime(proposal)}**`,
    faceitRoomLine(stored.match),
    `Accepted by: <@${message.author.id}>`,
    faceitLine
  ].join('\n'));

  await notifyAdmins(message.guild, stored, proposal, message.author.id, faceitLine);
}

async function handleTextDecline(message) {
  const stored = await getStoredMatchForChannel(message.channel);
  if (!stored) {
    await message.reply(await buildUnlinkedMatchChannelMessage(message.channel, [
      'Use `!decline` inside a match channel created by the bot.',
      'If this is a match room, run `/matches audit fix:true` so I can relink it.'
    ]));
    return;
  }

  const proposal = await getLatestOpenScheduleProposalForMatch(stored.match.id);
  if (!proposal) {
    await message.reply('There is no open schedule proposal for this match.');
    return;
  }

  const member = await message.guild.members.fetch(message.author.id);
  const memberTeam = getMemberTeam(member, stored.discord);
  const otherTeam = proposal.proposerTeam === 'teamA' ? 'teamB' : 'teamA';
  if (memberTeam !== otherTeam) {
    await message.reply('Only a member from the other team can decline this schedule.');
    return;
  }

  await declineScheduleProposal(proposal.id, message.author.id);
  await message.channel.send([
    `**Schedule declined:** ${stored.match.teamA} vs ${stored.match.teamB}`,
    `Declined time: **${formatProposalTime(proposal)}**`,
    faceitRoomLine(stored.match),
    `Declined by: <@${message.author.id}>`,
    'A team member can propose another time with `!schedule tomorrow at 9 PM EST`.'
  ].join('\n'));
}

async function handleCallAdmin(message, content) {
  const stored = await getStoredMatchForChannel(message.channel);
  if (!stored) {
    await message.reply(await buildUnlinkedMatchChannelMessage(message.channel, [
      'Use `!calladmin` inside a match channel created by the bot.',
      'If this is a match room, run `/matches audit fix:true` so I can relink it.'
    ]));
    return;
  }

  const reason = content.replace(/^!calladmin\s*/i, '').trim() || 'No reason given';
  const adminChannel = await getCallAdminChannel();
  const staffMentions = getStaffMentions(message.guild);
  const allowedMentions = getAdminAllowedMentions(message.guild);
  const matchDetails = getMatchDisplayDetails(stored.match);

  const alert = [
    staffMentions,
    '**ADMIN HELP REQUESTED**',
    `Match: **${stored.match.teamA} vs ${stored.match.teamB}**`,
    matchDetails.stage ? `Stage: **${matchDetails.stage}**` : null,
    `Round: **${matchDetails.round}**`,
    matchDetails.group ? `Group: **${matchDetails.group}**` : null,
    `Discord channel: <#${message.channel.id}>`,
    `Requested by: <@${message.author.id}>`,
    `Reason: ${reason}`,
    stored.match.faceitUrl ? `FACEIT: ${stored.match.faceitUrl}` : null
  ].filter(Boolean).join('\n');

  if (adminChannel) {
    await adminChannel.send({ content: alert, allowedMentions });
    await message.reply('Admins have been notified.');
    return;
  }

  await message.channel.send({ content: alert, allowedMentions });
}

async function getStoredMatchForChannel(channel) {
  const stored = await getStoredMatchByChannel(channel.id);
  if (stored) return stored;

  return recoverStoredMatchFromChannel(channel);
}

async function buildUnlinkedMatchChannelMessage(channel, baseLines) {
  const matches = await faceit.getMatches().catch(() => []);
  const likelyMatches = matches
    .filter((match) => channelLooksLikeMatch(channel, match))
    .slice(0, 5);
  const topicStatus = channel.topic
    ? 'Channel topic exists, but I could not match it to a FACEIT room/match ID.'
    : 'Channel topic is empty, so I could not read a FACEIT room/match ID from it.';
  const likelyLines = likelyMatches.length
    ? [
        'Closest FACEIT matches I can see:',
        ...likelyMatches.map((match) =>
          `- ${match.teamA} vs ${match.teamB} | ${match.categoryName || match.round}${match.group ? ` | ${match.group}` : ''}`
        )
      ]
    : ['I could not find a close FACEIT match from this channel name.'];

  return [
    ...baseLines,
    '',
    `Channel checked: <#${channel.id}> (\`${channel.name}\`)`,
    topicStatus,
    ...likelyLines,
    '',
    'Admin fix: run the real slash command `/matches audit`, then `/matches audit fix:true` if it reports missing links or permissions.'
  ].join('\n');
}

async function recoverStoredMatchFromChannel(channel) {
  if (!channel.guild) return null;

  const matches = await faceit.getMatches().catch(() => []);
  const match = matches.find((candidate) => channelMatchesFaceitMatch(channel, candidate));
  if (!match) return null;

  await channel.guild.roles.fetch().catch(() => null);
  const teamARole = await resolveTeamRole(channel.guild, config, match.teamA);
  const teamBRole = await resolveTeamRole(channel.guild, config, match.teamB);

  if (!teamARole || !teamBRole) {
    return null;
  }

  const discordIds = {
    categoryId: channel.parentId,
    channelId: channel.id,
    teamARoleId: teamARole.id,
    teamBRoleId: teamBRole.id
  };

  await saveMatch(match, discordIds);
  await upsertMatchIntroMessage(channel, match);

  return {
    match,
    discord: discordIds
  };
}

function channelMatchesFaceitMatch(channel, match) {
  const topic = String(channel.topic || '').toLowerCase();
  const faceitUrl = String(match.faceitUrl || '').toLowerCase();
  const matchId = String(match.id || '').toLowerCase();

  if (matchId && topic.includes(matchId)) return true;
  if (faceitUrl && topic.includes(faceitUrl)) return true;

  const channelName = normalizeDiscordChannelName(stripMatchStatusPrefix(channel.name));
  return recoverableMatchChannelNames(match).includes(channelName);
}

function recoverableMatchChannelNames(match) {
  const groupPrefix = getGroupLetterForMatch(match).toLowerCase();
  return [
    `${match.teamA} vs ${match.teamB}`,
    `${match.teamB} vs ${match.teamA}`
  ].map((name) => {
    const matchName = normalizeDiscordChannelName(name);
    return [groupPrefix, matchName].filter(Boolean).join('-').slice(0, 90);
  });
}

function recoverableMatchChannelName(match) {
  return recoverableMatchChannelNames(match)[0];
}

function channelLooksLikeMatch(channel, match) {
  const channelName = normalizeDiscordChannelName(stripMatchStatusPrefix(channel.name));
  const teamA = normalizeDiscordChannelName(match.teamA);
  const teamB = normalizeDiscordChannelName(match.teamB);
  const topic = String(channel.topic || '').toLowerCase();
  const matchId = String(match.id || '').toLowerCase();
  const faceitUrl = String(match.faceitUrl || '').toLowerCase();

  return Boolean(
    (teamA && teamB && channelName.includes(teamA) && channelName.includes(teamB)) ||
    (matchId && topic.includes(matchId)) ||
    (faceitUrl && topic.includes(faceitUrl))
  );
}

function stripMatchStatusPrefix(value) {
  return String(value || '')
    .replace(/^(?:🟡|🟢|v)-/i, '')
    .replace(/^(?:scheduled|finished)-/i, '');
}

function normalizeDiscordChannelName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

function truncateDiscordMessage(value) {
  return truncateText(value, 1900);
}

function truncateText(value, maxLength) {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 15)).trimEnd()}\n...truncated`;
}

async function handleDeprecatedScheduleInteraction(interaction) {
  const response = {
    content: 'Scheduling is command-only now. In the match room, use `!schedule September 1 8 PM EST`; teams confirm with `!accept`, and Tournament Ops can schedule directly.',
    components: [],
    ephemeral: true
  };

  if (interaction.isMessageComponent()) {
    await interaction.update({ content: response.content, components: [] }).catch(async () => {
      await interaction.followUp(response).catch(() => null);
    });
    return;
  }

  if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
    await interaction.reply(response);
  }
}

async function applyAcceptedSchedule(channel, stored, proposal, acceptedBy) {
  await acceptScheduleProposal(proposal.id, acceptedBy);
  const result = await scheduleFaceitMatch(
    config,
    proposal.matchId,
    proposal.scheduledAtIso || proposal.scheduledAt,
    proposal.timezone
  );
  const faceitLine = result.skipped
    ? adminActionLine(proposal)
    : 'FACEIT schedule updated.';
  const scheduledMatch = {
    ...stored.match,
    status: 'scheduled',
    scheduledAt: proposal.scheduledAt
  };
  await updateMatchChannelName(channel, scheduledMatch);
  await saveMatch(scheduledMatch, stored.discord);
  return faceitLine;
}

async function notifyAdmins(guild, stored, proposal, acceptedBy, faceitLine) {
  const channel = await getScheduleAdminChannel();
  const allowedMentions = getAdminAllowedMentions(guild);
  const matchDetails = getMatchDisplayDetails(stored.match);
  const content = [
    getStaffMentions(guild),
    proposal.kind === 'reschedule'
      ? '**ACTION NEEDED: Approve reschedule and update FACEIT**'
      : '**ACTION NEEDED: Schedule on FACEIT**',
    `Match: **${stored.match.teamA} vs ${stored.match.teamB}**`,
    matchDetails.stage ? `Stage: **${matchDetails.stage}**` : null,
    `Round: **${matchDetails.round}**`,
    matchDetails.group ? `Group: **${matchDetails.group}**` : null,
    `Accepted time: **${formatProposalTime(proposal)}**`,
    proposal.scheduledAtIso ? `Discord time: ${discordTimestamp(proposal.scheduledAtIso, 'F')}` : null,
    proposal.kind === 'reschedule' ? `Current/previous schedule: **${currentScheduleText(stored)}**` : null,
    `Proposed by: <@${proposal.proposedBy}>`,
    proposal.override ? `Set by Tournament Ops: <@${acceptedBy}>` : `Accepted by: <@${acceptedBy}>`,
    proposal.validation?.warning ? `Warning: **${proposal.validation.warning}**` : null,
    proposal.validation?.roundWindowMessage ? proposal.validation.roundWindowMessage : null,
    faceitRoomLine(stored.match),
    faceitLine
  ].filter(Boolean).join('\n');
  const targetChannel = channel || await guild.channels.fetch(stored.discord.channelId).catch(() => null);

  if (!targetChannel) return;

  await targetChannel.send({
    content,
    allowedMentions,
    components: [adminDecisionButtons(proposal.id)]
  });
}

async function upsertMatchIntroMessage(channel, match) {
  const stored = await getStoredMatch(match.id);
  const discordIds = stored?.discord || {};
  const content = buildMatchIntroMessage(channel, match, discordIds);
  const allowedMentions = getIntroAllowedMentions(discordIds);
  const existingMessage = stored?.discord?.introMessageId
    ? await channel.messages.fetch(stored.discord.introMessageId).catch(() => null)
    : null;

  if (existingMessage) {
    await existingMessage.edit({
      content,
      allowedMentions,
      components: []
    });
    return;
  }

  const message = await channel.send({
    content,
    allowedMentions
  });
  await saveMatchIntroMessageId(match.id, message.id);
  await message.pin().catch(() => null);
}

function buildMatchIntroMessage(channel, match, discordIds = {}) {
  const roundInfo = getSeasonRoundInfo(match);
  const scheduleWindow = getScheduleWindowForMatch(match);
  const matchDetails = getMatchDisplayDetails(match);
  const teamMentions = [
    discordIds.teamARoleId ? `<@&${discordIds.teamARoleId}>` : `**${match.teamA}**`,
    discordIds.teamBRoleId ? `<@&${discordIds.teamBRoleId}>` : `**${match.teamB}**`
  ].join(' vs ');
  const ticketChannel = config.rosterTicketChannelId
    ? `<#${config.rosterTicketChannelId}>`
    : getChannelMentionByName(channel.guild, 'make-a-ticket') || '#make-a-ticket';
  const adminNotificationLine = getAdminNotificationLine(channel);

  return [
    teamMentions,
    '',
    `**${match.teamA} vs ${match.teamB}**`,
    '',
    matchDetails.stage ? `Stage: **${matchDetails.stage}**` : null,
    `Round: **${matchDetails.round}**`,
    matchDetails.group ? `Group: **${matchDetails.group}**` : null,
    scheduleWindow ? `${scheduleWindow.label}: **${scheduleWindow.start} - ${scheduleWindow.end}**` : 'Scheduling window: **not configured yet**',
    roundInfo ? `Default round date/time: **${roundInfo.defaultDate} at 8:00 PM EST**` : 'Default round date/time: **admins will announce**',
    `Discord match chat: <#${channel.id}>`,
    faceitRoomLine(match),
    getFaceitScheduledTimeLine(match),
    '',
    '**How to schedule this match**',
    '1. One team member posts `!schedule 8/24/2026 3 PM EST`, `!schedule Tuesday 3 PM EST`, or `!schedule September 1 8:00 PM EST`.',
    '2. The bot detects the timezone, records the proposed time, and pings the other team role.',
    '3. A member from the other team posts `!accept` to confirm or `!decline` to reject.',
    `4. After \`!accept\`, ${adminNotificationLine}`,
    'Tournament Ops can use `!schedule September 1 8 PM EST` to set the time directly without team approval.',
    '',
    '**Other commands**',
    '`!propose July 28 8:00 PM EST` - same as `!schedule`',
    '`!reschedule July 29 8:00 PM EST` - team member requests a new time',
    'Schedules and reschedules must stay inside the scheduling window. Reschedules within 24 hours of match time require admin override.',
    isGroupStageMatch(match)
      ? 'Group Stage note: any Group Stage match can be scheduled by mutual agreement from August 31, 2026 through September 8, 2026.'
      : null,
    `Roster changes: go to ${ticketChannel}.`,
    '',
    '**Admin Help**',
    '`!calladmin reason here` - alerts admins with this match channel and FACEIT link'
  ].filter((line) => line !== null).join('\n');
}

function getAdminNotificationLine(channel) {
  return 'admins are notified and pinged to schedule it on FACEIT.';
}

function getMatchDisplayDetails(match) {
  const roundNumber = getGroupStageRoundNumber(match);
  const isGroupStage = isGroupStageMatch(match) || roundNumber !== 999;
  const group = match.group ? match.group.replace(/^Group\s+/i, '') : '';

  if (isGroupStage && roundNumber !== 999) {
    return {
      stage: 'Group Stage',
      round: String(roundNumber),
      group
    };
  }

  return {
    stage: '',
    round: match.round,
    group
  };
}

function getFaceitScheduledTimeLine(match) {
  if (match.scheduledAt) {
    return `FACEIT scheduled time: **${match.scheduledAt}**`;
  }

  return null;
}

function faceitRoomLine(match) {
  return match.faceitUrl
    ? `FACEIT match room: ${match.faceitUrl}`
    : 'FACEIT match room: not linked';
}

function getIntroAllowedMentions(discordIds = {}) {
  return {
    roles: [
      discordIds.teamARoleId,
      discordIds.teamBRoleId
    ].filter(Boolean),
    users: [],
    repliedUser: false
  };
}

function getSeasonRoundInfo(match) {
  const stageName = String(match.source?.name || match.round || '').toLowerCase();
  const roundName = String(match.round || '').toLowerCase();

  if (stageName.includes('group')) {
    const groupStageRound = getGroupStageRoundNumber(match);
    if (groupStageRound === 1) return seasonWindow('Round 1');
    if (groupStageRound === 2) return seasonWindow('Round 2');
    if (groupStageRound === 3) return seasonWindow('Round 3');
    if (/\bround\s*1\b/.test(roundName)) return seasonWindow('Round 1');
    if (/\bround\s*2\b/.test(roundName)) return seasonWindow('Round 2');
    if (/\bround\s*3\b/.test(roundName)) return seasonWindow('Round 3');
    return seasonWindow('Group Stage');
  }

  const text = `${stageName} ${roundName}`;
  if (text.includes('grand final')) return seasonWindow('Grand Final (BO5)');
  if (text.includes('losers final') || text.includes('lower final')) return seasonWindow('Losers Final');
  if (text.includes('losers round 7') || text.includes('lower round 7')) return seasonWindow('Losers Round 7');
  if ((text.includes('winner') && text.includes('final')) || text.includes('wb final') || text.includes('upper final')) return seasonWindow('WB Final + Losers Round 6');
  if (text.includes('losers round 6') || text.includes('lower round 6')) return seasonWindow('WB Final + Losers Round 6');
  if (text.includes('losers round 5') || text.includes('lower round 5')) return seasonWindow('Losers Round 5');
  if (text.includes('semi') || text.includes('losers round 4') || text.includes('lower round 4')) return seasonWindow('WB Semifinals + Losers Round 4');
  if (text.includes('losers round 3') || text.includes('lower round 3')) return seasonWindow('Losers Round 3');
  if (text.includes('quarter') || text.includes('losers round 2') || text.includes('lower round 2')) return seasonWindow('WB Quarterfinals + Losers Round 2');
  if (text.includes('round of 16') || text.includes('losers round 1') || text.includes('lower round 1')) return seasonWindow('WB Round of 16 + Losers Round 1');
  if (text.includes('round of 32')) return seasonWindow('WB Round of 32');

  if (stageName.includes('playoff')) return seasonWindow('Playoff Stage');
  return null;
}

function seasonWindow(name) {
  return SEASON_SCHEDULE.find((entry) => entry.name === name) || null;
}

function isGroupStageMatch(match) {
  return String(match.source?.name || match.round || '').toLowerCase().includes('group');
}

function getChannelMentionByName(guild, name) {
  const channel = guild.channels.cache.find((candidate) =>
    candidate.name?.toLowerCase() === name.toLowerCase()
  );
  return channel ? `<#${channel.id}>` : null;
}

async function getScheduleAdminChannel() {
  if (!config.adminScheduleChannelId) return null;
  return fetchBotChannel(config.adminScheduleChannelId);
}

async function getCallAdminChannel() {
  if (!config.callAdminChannelId) return null;
  return fetchBotChannel(config.callAdminChannelId);
}

async function fetchBotChannel(channelId) {
  return client.channels.fetch(channelId).catch(() => null);
}

function getStaffMentions(guild) {
  if (config.adminAlertRoleIds.length) {
    return config.adminAlertRoleIds.map((roleId) => `<@&${roleId}>`).join(' ');
  }

  const mentions = [];

  if (config.discordStaffRoleId) {
    mentions.push(`<@&${config.discordStaffRoleId}>`);
  }

  for (const roleName of config.matchAccessRoleNames) {
    const role = guild.roles.cache.find((candidate) =>
      candidate.name.toLowerCase() === roleName.toLowerCase()
    );
    if (role) mentions.push(`<@&${role.id}>`);
  }

  for (const roleId of config.matchAccessRoleIds) {
    mentions.push(`<@&${roleId}>`);
  }

  return [...new Set(mentions)].join(' ');
}

function getAdminAllowedMentions(guild) {
  const roles = config.adminAlertRoleIds.length
    ? config.adminAlertRoleIds
    : [
        config.discordStaffRoleId,
        ...config.matchAccessRoleIds,
        ...config.matchAccessRoleNames
          .map((roleName) => guild.roles.cache.find((candidate) =>
            candidate.name.toLowerCase() === roleName.toLowerCase()
          )?.id)
      ];

  return {
    roles: [...new Set(roles.filter(Boolean))],
    users: [],
    repliedUser: false
  };
}

async function handleAdminScheduleDecision(interaction, approved) {
  await interaction.deferReply({ ephemeral: true });

  if (!isAdminStaff(interaction.member)) {
    await interaction.editReply('Only match staff/admins can use this.');
    return;
  }

  const proposalId = interaction.customId.split(':')[1];
  const proposal = approved
    ? await approveScheduleProposal(proposalId, interaction.user.id)
    : await denyScheduleProposal(proposalId, interaction.user.id);

  if (!proposal) {
    await interaction.editReply('I could not find that schedule request.');
    return;
  }

  const stored = await getStoredMatch(proposal.matchId);
  const matchChannel = stored
    ? await client.channels.fetch(stored.discord.channelId).catch(() => null)
    : null;

  if (matchChannel) {
    await matchChannel.send([
      approved ? '**Admin approved schedule request.**' : '**Admin denied schedule request.**',
      `Time: **${formatProposalTime(proposal)}**`,
      `Admin: <@${interaction.user.id}>`
    ].join('\n'));
  }

  if (approved) {
    await interaction.message.react('✅').catch(() => null);
  }

  await interaction.editReply(approved ? 'Approved and match channel notified.' : 'Denied and match channel notified.');
}

function isAdminStaff(member) {
  if (member.permissions?.has(PermissionFlagsBits.Administrator) ||
      member.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    return true;
  }

  if (config.discordStaffRoleId && member.roles.cache.has(config.discordStaffRoleId)) {
    return true;
  }

  if (config.adminAlertRoleIds.some((roleId) => member.roles.cache.has(roleId))) {
    return true;
  }

  return config.matchAccessRoleNames.some((roleName) =>
    member.roles.cache.some((role) => role.name.toLowerCase() === roleName.toLowerCase())
  ) ||
    config.matchAccessRoleIds.some((roleId) => member.roles.cache.has(roleId)) ||
    config.scheduleOverrideRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

function canUseBotAdminCommand(member) {
  if (member.permissions?.has(PermissionFlagsBits.Administrator) ||
      member.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    return true;
  }

  return Boolean(config.discordStaffRoleId && member.roles.cache.has(config.discordStaffRoleId));
}

function hasScheduleOverride(member) {
  return config.scheduleOverrideRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

function validateScheduleRequest(stored, proposedText, kind, parsedDate = null) {
  const proposedDate = parsedDate || parseScheduleText(proposedText);
  const window = getScheduleWindowForMatch(stored.match);
  const result = {
    allowed: true,
    warning: null,
    roundWindowMessage: window
      ? `${window.label}: **${window.start} to ${window.end}**`
      : 'Scheduling window: **not configured; admins must verify manually**'
  };

  if (window && proposedDate) {
    const start = parseScheduleText(`${window.start} 12:00 AM EST`);
    const end = parseScheduleText(`${window.end} 11:59 PM EST`);
    if (start && end && (proposedDate < start || proposedDate > end)) {
      return {
        ...result,
        allowed: false,
        message: `That time is outside the scheduling window (${window.start} to ${window.end}). Ask an admin if you need an exception.`
      };
    }
  }

  if (kind === 'reschedule' && isWithin24Hours(stored)) {
    result.warning = 'Inside 24 hours of match time. Admin override required.';
  }

  if (window && !proposedDate) {
    result.warning = 'I could not read that date automatically. Admins must verify it is inside the scheduling window.';
  }

  return result;
}

function getScheduleWindowForMatch(match) {
  const configuredWindow = config.roundWindows[String(match.round || '').toLowerCase()];
  if (configuredWindow) {
    return {
      ...configuredWindow,
      label: 'Scheduling window'
    };
  }

  if (isGroupStageMatch(match)) {
    const groupStage = seasonWindow('Group Stage');
    if (!groupStage) return null;

    return {
      start: groupStage.start,
      end: groupStage.end,
      label: 'Group Stage scheduling window'
    };
  }

  const roundInfo = getSeasonRoundInfo(match);
  if (!roundInfo) return null;

  return {
    start: roundInfo.start,
    end: roundInfo.end,
    label: 'Scheduling window'
  };
}

function isWithin24Hours(stored) {
  const currentDate = parseScheduleText(currentScheduleText(stored));
  if (!currentDate) return false;

  const msUntilMatch = currentDate.getTime() - Date.now();
  return msUntilMatch > 0 && msUntilMatch <= 24 * 60 * 60 * 1000;
}

function currentScheduleText(stored) {
  return stored.match.scheduledAt || 'not set';
}

function parseScheduleText(value) {
  if (!value || value === 'not set') return null;
  const parsed = Date.parse(String(value).replace(/\bET\b/i, 'EST'));
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed);
}

function parseScheduleInput(value) {
  const original = String(value || '').trim();
  const cleaned = original
    .replace(/<@!?\d+>/g, ' ')
    .replace(/\bgame\s*time\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const timeMatch = cleaned.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!timeMatch) return null;

  const zone = detectScheduleTimezone(cleaned);
  const dateParts = parseScheduleDateParts(cleaned, zone.timeZone);
  if (!dateParts) return null;

  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] || 0);
  const ampm = timeMatch[3].toLowerCase();
  if (ampm === 'pm' && hour !== 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;

  const date = zonedTimeToUtc(
    dateParts.year,
    dateParts.month,
    dateParts.day,
    hour,
    minute,
    zone.timeZone
  );
  if (!date || Number.isNaN(date.getTime())) return null;

  return {
    date,
    iso: date.toISOString(),
    timeZone: zone.timeZone,
    timeZoneInput: zone.input,
    display: formatScheduleDisplay(date, zone.timeZone),
    discordTimestamp: discordTimestamp(date.toISOString(), 'F')
  };
}

function detectScheduleTimezone(value) {
  const normalized = String(value || '').toLowerCase();
  const zones = [
    { pattern: /\b(eastern|est|edt|et)\b/i, timeZone: 'America/New_York', input: 'ET' },
    { pattern: /\b(central|cst|cdt|ct)\b/i, timeZone: 'America/Chicago', input: 'CT' },
    { pattern: /\b(mountain|mst|mdt|mt)\b/i, timeZone: 'America/Denver', input: 'MT' },
    { pattern: /\b(pacific|pst|pdt|pt)\b/i, timeZone: 'America/Los_Angeles', input: 'PT' },
    { pattern: /\b(utc|gmt)\b/i, timeZone: 'UTC', input: 'UTC' }
  ];

  return zones.find((zone) => zone.pattern.test(normalized)) || {
    timeZone: config.defaultTimezone,
    input: config.defaultTimezone
  };
}

function parseScheduleDateParts(value, timeZone) {
  const normalized = normalizeScheduleDateText(value);
  const base = nowPartsInTimeZone(timeZone);

  if (/\btomorrow\b/i.test(normalized)) {
    return addDaysToParts(base, 1);
  }

  if (/\btoday\b/i.test(normalized)) {
    return base;
  }

  const iso = normalized.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    return {
      year: Number(iso[1]),
      month: Number(iso[2]),
      day: Number(iso[3])
    };
  }

  const numericDate = normalized.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
  if (numericDate) {
    const year = numericDate[3]
      ? normalizeYear(Number(numericDate[3]))
      : base.year;
    return {
      year,
      month: Number(numericDate[1]),
      day: Number(numericDate[2])
    };
  }

  const monthNames = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12
  };
  const monthPattern = Object.keys(monthNames).join('|');
  const monthMatch = normalized.match(new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:,?\\s*(20\\d{2}))?\\b`, 'i'));
  if (monthMatch) {
    return {
      year: monthMatch[3] ? Number(monthMatch[3]) : base.year,
      month: monthNames[monthMatch[1].toLowerCase()],
      day: Number(monthMatch[2])
    };
  }

  const weekdayParts = parseWeekdayDateParts(normalized, base);
  if (weekdayParts) return weekdayParts;

  return null;
}

function normalizeScheduleDateText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/g, '$1')
    .replace(/\bat\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseWeekdayDateParts(value, base) {
  const weekdays = {
    sunday: 0,
    sun: 0,
    monday: 1,
    mon: 1,
    tuesday: 2,
    tue: 2,
    tues: 2,
    wednesday: 3,
    wed: 3,
    thursday: 4,
    thu: 4,
    thurs: 4,
    friday: 5,
    fri: 5,
    saturday: 6,
    sat: 6
  };
  const pattern = Object.keys(weekdays).join('|');
  const match = value.match(new RegExp(`\\b(?:this\\s+|next\\s+)?(${pattern})\\b`, 'i'));
  if (!match) return null;

  const targetDay = weekdays[match[1].toLowerCase()];
  const baseDate = new Date(Date.UTC(base.year, base.month - 1, base.day, 12, 0, 0));
  const currentDay = baseDate.getUTCDay();
  let offset = (targetDay - currentDay + 7) % 7;

  if (match[0].toLowerCase().startsWith('next ')) {
    offset += 7;
  }

  return addDaysToParts(base, offset);
}

function nowPartsInTimeZone(timeZone) {
  return datePartsInTimeZone(new Date(), timeZone);
}

function addDaysToParts(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function normalizeYear(value) {
  if (value < 100) return 2000 + value;
  return value;
}

function zonedTimeToUtc(year, month, day, hour, minute, timeZone) {
  const targetUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = new Date(targetUtc);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = dateTimePartsInTimeZone(guess, timeZone);
    const actualAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
    const diff = targetUtc - actualAsUtc;
    if (diff === 0) return guess;
    guess = new Date(guess.getTime() + diff);
  }

  return guess;
}

function datePartsInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === 'year')?.value),
    month: Number(parts.find((part) => part.type === 'month')?.value),
    day: Number(parts.find((part) => part.type === 'day')?.value)
  };
}

function dateTimePartsInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === 'year')?.value),
    month: Number(parts.find((part) => part.type === 'month')?.value),
    day: Number(parts.find((part) => part.type === 'day')?.value),
    hour: Number(parts.find((part) => part.type === 'hour')?.value),
    minute: Number(parts.find((part) => part.type === 'minute')?.value)
  };
}

function formatScheduleDisplay(date, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(date);
}

function formatProposalTime(proposal) {
  const timestamp = proposal.scheduledAtIso
    ? ` (${discordTimestamp(proposal.scheduledAtIso, 'F')})`
    : '';
  return `${proposal.scheduledAt}${timestamp}`;
}

function discordTimestamp(isoValue, style = 'F') {
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return null;
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

function adminActionLine(proposal) {
  if (proposal.kind === 'reschedule') {
    return 'Admins must approve this reschedule and update FACEIT.';
  }

  return 'Admins still need to schedule this on FACEIT.';
}

function adminDecisionButtons(proposalId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`admin_schedule_approve:${proposalId}`)
      .setLabel('Admin approve')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`admin_schedule_deny:${proposalId}`)
      .setLabel('Admin deny')
      .setStyle(ButtonStyle.Danger)
  );
}

function getMemberTeam(member, discordIds) {
  if (member.roles.cache.has(discordIds.teamARoleId)) return 'teamA';
  if (member.roles.cache.has(discordIds.teamBRoleId)) return 'teamB';
  return null;
}

function makeProposalId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

client.login(config.discordToken);

function claimSingleInstance(filePath) {
  if (fs.existsSync(filePath)) {
    const existingPid = Number(fs.readFileSync(filePath, 'utf8'));
    if (existingPid && processIsRunning(existingPid)) {
      console.error(`Another bot instance is already running with PID ${existingPid}.`);
      process.exit(1);
    }
  }

  fs.writeFileSync(filePath, String(process.pid));

  const cleanup = () => {
    try {
      if (fs.readFileSync(filePath, 'utf8') === String(process.pid)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Best-effort cleanup only.
    }
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });
}

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function safelyRespondToInteraction(interaction, message) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: message, ephemeral: true });
      return;
    }

    await interaction.reply({ content: message, ephemeral: true });
  } catch (error) {
    console.error(`Could not send interaction error response: ${error.message}`);
  }
}
