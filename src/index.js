import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
  StringSelectMenuBuilder
} from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';

import { commands } from './commands.js';
import { getConfig } from './config.js';
import { FaceitClient } from './faceit.js';
import { provisionMatchChannel } from './discordProvision.js';
import {
  acceptScheduleProposal,
  approveScheduleProposal,
  denyScheduleProposal,
  declineScheduleProposal,
  getLatestOpenScheduleProposalForMatch,
  getScheduleProposal,
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
      if (!isAdminStaff(interaction.member)) {
        await interaction.reply({ content: 'Only admins/match staff can use this bot command.', ephemeral: true });
        return;
      }

      await handleAdminCommand(interaction);

    }

    if (interaction.isButton() && interaction.customId.startsWith('schedule:')) {
      await showScheduleDatePicker(interaction);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('schedule_date:')) {
      await showScheduleTimePicker(interaction);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('schedule_time:')) {
      await handleScheduleTimeSelected(interaction);
    }

    if (interaction.isButton() && interaction.customId.startsWith('schedule_accept:')) {
      await handleScheduleAccepted(interaction);
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

  const guild = await client.guilds.fetch(config.discordGuildId);
  await guild.channels.fetch();
  await guild.roles.fetch();

  const matches = await faceit.getMatches();
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

  await interaction.editReply(`Synced ${created} match channel(s). Skipped ${skipped}.`);
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
        `Syncing team roles... ${progress.current}/${progress.total} teams checked. Created ${progress.rolesCreated} role(s), added ${progress.added} team role assignment(s), ${progress.participantAdded} participant assignment(s), ${progress.captainAdded} captain assignment(s). Captain DMs: **${notifyCaptains ? 'on' : 'off'}**.`
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
    `Synced team roles from Google Sheet. Created ${result.rolesCreated} role(s), added ${result.added} team role assignment(s), ${result.participantAdded} season participant assignment(s), ${result.captainAdded} captain role assignment(s), changed ${result.nicknamesChanged} nickname(s), sent ${result.captainDmsSent} captain DM(s). Skipped ${result.skipped}.${missingLine}${failedLine}`
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
  const stored = await getStoredMatchByChannel(message.channel.id);
  if (!stored) {
    await message.reply([
      kind === 'reschedule'
        ? 'Use `!reschedule` inside a match channel created by the bot.'
        : 'Use `!schedule` or `!propose` inside a match channel created by the bot.',
      'If this should be a match room, run `/matches sync` first so I can link the channel to the FACEIT match.'
    ].join('\n'));
    return;
  }

  const member = await message.guild.members.fetch(message.author.id);
  const proposerTeam = getMemberTeam(member, stored.discord);
  if (!proposerTeam || !isCaptain(member)) {
    await message.reply('Only a captain from one of the two teams can propose a schedule.');
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
  const otherTeam = proposerTeam === 'teamA' ? 'teamB' : 'teamA';
  const otherRoleId = otherTeam === 'teamA'
    ? stored.discord.teamARoleId
    : stored.discord.teamBRoleId;

  await saveScheduleProposal({
    id: proposalId,
    matchId: stored.match.id,
    scheduledAt,
    scheduledAtIso: parsedSchedule?.iso || null,
    timezone: parsedSchedule?.timeZone || config.defaultTimezone,
    timezoneInput: parsedSchedule?.timeZoneInput || null,
    proposedBy: message.author.id,
    proposerTeam,
    accepted: false,
    kind,
    source: 'text',
    validation
  });

  await message.channel.send([
    `<@&${otherRoleId}>`,
    `**${kind === 'reschedule' ? 'Reschedule' : 'Schedule'} proposed:** ${stored.match.teamA} vs ${stored.match.teamB}`,
    `Time: **${scheduledAt}**${parsedSchedule?.discordTimestamp ? ` (${parsedSchedule.discordTimestamp})` : ''}`,
    `Proposed by: <@${message.author.id}>`,
    validation.warning ? `Warning: **${validation.warning}**` : null,
    'Other team captain: type `!accept` or `!decline` to confirm.'
  ].filter(Boolean).join('\n'));
}

async function handleTextAccept(message) {
  const stored = await getStoredMatchByChannel(message.channel.id);
  if (!stored) {
    await message.reply('Use `!accept` inside a match channel created by the bot.');
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
  if (memberTeam !== otherTeam || !isCaptain(member)) {
    await message.reply('Only a captain from the other team can accept this schedule.');
    return;
  }

  await acceptScheduleProposal(proposal.id, message.author.id);
  const result = await scheduleFaceitMatch(
    config,
    proposal.matchId,
    proposal.scheduledAtIso || proposal.scheduledAt,
    proposal.timezone
  );
  const faceitLine = result.skipped
    ? adminActionLine(proposal)
    : 'FACEIT schedule updated.';

  await message.channel.send([
    `**${proposal.kind === 'reschedule' ? 'Reschedule' : 'Schedule'} accepted:** ${stored.match.teamA} vs ${stored.match.teamB}`,
    `Time: **${formatProposalTime(proposal)}**`,
    `Accepted by: <@${message.author.id}>`,
    faceitLine
  ].join('\n'));

  await notifyAdmins(message.guild, stored, proposal, message.author.id, faceitLine);
}

async function handleTextDecline(message) {
  const stored = await getStoredMatchByChannel(message.channel.id);
  if (!stored) {
    await message.reply('Use `!decline` inside a match channel created by the bot.');
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
  if (memberTeam !== otherTeam || !isCaptain(member)) {
    await message.reply('Only a captain from the other team can decline this schedule.');
    return;
  }

  await declineScheduleProposal(proposal.id, message.author.id);
  await message.channel.send([
    `**Schedule declined:** ${stored.match.teamA} vs ${stored.match.teamB}`,
    `Declined time: **${formatProposalTime(proposal)}**`,
    `Declined by: <@${message.author.id}>`,
    'A team captain can propose another time with `!schedule tomorrow at 9 PM EST`.'
  ].join('\n'));
}

async function handleCallAdmin(message, content) {
  const stored = await getStoredMatchByChannel(message.channel.id);
  if (!stored) {
    await message.reply('Use `!calladmin` inside a match channel created by the bot.');
    return;
  }

  const reason = content.replace(/^!calladmin\s*/i, '').trim() || 'No reason given';
  const adminChannel = await getAdminAlertChannel(message.guild);
  const staffMentions = getStaffMentions(message.guild);
  const allowedMentions = getAdminAllowedMentions(message.guild);

  const alert = [
    staffMentions,
    '**ADMIN HELP REQUESTED**',
    `Match: **${stored.match.teamA} vs ${stored.match.teamB}**`,
    `Round: **${stored.match.round}**`,
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

async function showScheduleDatePicker(interaction) {
  const matchId = interaction.customId.split(':')[1];
  const stored = await getStoredMatch(matchId);
  if (!stored) {
    await interaction.reply({ content: 'I could not find that stored match. Run `/matches sync` again.', ephemeral: true });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const proposerTeam = getMemberTeam(member, stored.discord);
  if (!proposerTeam || !isCaptain(member)) {
    await interaction.reply({
      content: 'Only a captain from one of the two teams can propose a schedule.',
      ephemeral: true
    });
    return;
  }

  const dateMenu = new StringSelectMenuBuilder()
    .setCustomId(`schedule_date:${matchId}:${proposerTeam}`)
    .setPlaceholder('Pick a match date')
    .addOptions(nextDateOptions());

  await interaction.reply({
    content: `Pick a date for **${stored.match.teamA} vs ${stored.match.teamB}**.`,
    components: [new ActionRowBuilder().addComponents(dateMenu)],
    ephemeral: true
  });
}

async function showScheduleTimePicker(interaction) {
  const [, matchId, proposerTeam] = interaction.customId.split(':');
  const selectedDate = interaction.values[0];
  const timeMenu = new StringSelectMenuBuilder()
    .setCustomId(`schedule_time:${matchId}:${proposerTeam}:${selectedDate}`)
    .setPlaceholder('Pick a match time')
    .addOptions(timeOptions(selectedDate));

  await interaction.update({
    content: `Date selected: **${formatDateLabel(selectedDate)}**. Now pick a time.`,
    components: [new ActionRowBuilder().addComponents(timeMenu)]
  });
}

async function handleScheduleTimeSelected(interaction) {
  const [, matchId, proposerTeam, selectedDate] = interaction.customId.split(':');
  const stored = await getStoredMatch(matchId);
  if (!stored) {
    await interaction.update({ content: 'I could not find that stored match. Run `/matches sync` again.', components: [] });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (getMemberTeam(member, stored.discord) !== proposerTeam || !isCaptain(member)) {
    await interaction.update({ content: 'Only the proposing team captain can finish this proposal.', components: [] });
    return;
  }

  const selectedTime = interaction.values[0];
  const scheduledAt = `${selectedDate} ${selectedTime}`;
  const parsedSchedule = parseScheduleInput(`${selectedDate} ${selectedTime} ${config.defaultTimezone}`);
  const displayScheduledAt = parsedSchedule?.display || `${scheduledAt} ${config.defaultTimezone}`;
  const proposalId = makeProposalId();
  const otherTeam = proposerTeam === 'teamA' ? 'teamB' : 'teamA';
  const otherRoleId = otherTeam === 'teamA'
    ? stored.discord.teamARoleId
    : stored.discord.teamBRoleId;

  await saveScheduleProposal({
    id: proposalId,
    matchId,
    scheduledAt: displayScheduledAt,
    scheduledAtIso: parsedSchedule?.iso || null,
    timezone: parsedSchedule?.timeZone || config.defaultTimezone,
    proposedBy: interaction.user.id,
    proposerTeam,
    accepted: false
  });

  await interaction.channel.send({
    content: [
      `<@&${otherRoleId}>`,
      `**Schedule proposed:** ${stored.match.teamA} vs ${stored.match.teamB}`,
      `Time: **${displayScheduledAt}**${parsedSchedule?.discordTimestamp ? ` (${parsedSchedule.discordTimestamp})` : ''}`,
      `Proposed by: <@${interaction.user.id}>`,
      'A captain from the other team must accept this.'
    ].join('\n'),
    components: [acceptButton(proposalId)]
  });

  await interaction.update({
    content: `Proposal posted for **${displayScheduledAt}**.`,
    components: []
  });
}

async function handleScheduleAccepted(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const proposalId = interaction.customId.split(':')[1];
  const proposal = await getScheduleProposal(proposalId);
  if (!proposal) {
    await interaction.editReply('I could not find that schedule proposal.');
    return;
  }

  if (proposal.accepted) {
    await interaction.editReply('That schedule was already accepted.');
    return;
  }

  const stored = await getStoredMatch(proposal.matchId);
  if (!stored) {
    await interaction.editReply('I could not find the stored match for that proposal.');
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const memberTeam = getMemberTeam(member, stored.discord);
  const otherTeam = proposal.proposerTeam === 'teamA' ? 'teamB' : 'teamA';
  if (memberTeam !== otherTeam || !isCaptain(member)) {
    await interaction.editReply('Only a captain from the other team can accept this schedule.');
    return;
  }

  await acceptScheduleProposal(proposalId, interaction.user.id);
  const result = await scheduleFaceitMatch(
    config,
    proposal.matchId,
    proposal.scheduledAtIso || proposal.scheduledAt,
    proposal.timezone
  );
  const faceitLine = result.skipped
    ? adminActionLine(proposal)
    : 'FACEIT schedule updated.';

  await interaction.channel.send([
    `**Schedule accepted:** ${stored.match.teamA} vs ${stored.match.teamB}`,
    `Time: **${formatProposalTime(proposal)}**`,
    `Accepted by: <@${interaction.user.id}>`,
    faceitLine
  ].join('\n'));

  await notifyAdmins(interaction.guild, stored, proposal, interaction.user.id, faceitLine);
  await interaction.editReply('Schedule accepted and admins were notified.');
}

async function notifyAdmins(guild, stored, proposal, acceptedBy, faceitLine) {
  const channel = await getAdminAlertChannel(guild);
  const allowedMentions = getAdminAllowedMentions(guild);
  const content = [
    getStaffMentions(guild),
    proposal.kind === 'reschedule'
      ? '**ACTION NEEDED: Approve reschedule and update FACEIT**'
      : '**ACTION NEEDED: Schedule on FACEIT**',
    `Match: **${stored.match.teamA} vs ${stored.match.teamB}**`,
    `Round: **${stored.match.round}**`,
    `Accepted time: **${formatProposalTime(proposal)}**`,
    proposal.scheduledAtIso ? `Discord time: ${discordTimestamp(proposal.scheduledAtIso, 'F')}` : null,
    proposal.kind === 'reschedule' ? `Current/previous schedule: **${currentScheduleText(stored)}**` : null,
    `Proposed by: <@${proposal.proposedBy}>`,
    `Accepted by: <@${acceptedBy}>`,
    proposal.validation?.warning ? `Warning: **${proposal.validation.warning}**` : null,
    proposal.validation?.roundWindowMessage ? proposal.validation.roundWindowMessage : null,
    stored.match.faceitUrl ? `FACEIT: ${stored.match.faceitUrl}` : null,
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
  const teamMentions = [
    discordIds.teamARoleId ? `<@&${discordIds.teamARoleId}>` : `**${match.teamA}**`,
    discordIds.teamBRoleId ? `<@&${discordIds.teamBRoleId}>` : `**${match.teamB}**`
  ].join(' vs ');
  const ticketChannel = getChannelMentionByName(channel.guild, 'make-a-ticket') || '#make-a-ticket';
  const adminNotificationLine = getAdminNotificationLine(channel);

  return [
    teamMentions,
    '',
    `**${match.teamA} vs ${match.teamB}**`,
    '',
    `Round: **${match.round}**`,
    roundInfo ? `Round window: **${roundInfo.start} - ${roundInfo.end}**` : 'Round window: **not configured for this round yet**',
    roundInfo ? `Default match day/time: **${roundInfo.defaultDate} at 8:00 PM EST**` : 'Default match day/time: **admins will announce**',
    `Discord match chat: <#${channel.id}>`,
    match.faceitUrl ? `FACEIT match room: ${match.faceitUrl}` : null,
    match.scheduledAt ? `FACEIT default schedule: **${match.scheduledAt}**` : 'FACEIT default schedule: **not set**',
    '',
    '**How to schedule this match**',
    '1. One team captain posts `!schedule 8/24/2026 3 PM EST`, `!schedule Tuesday 3 PM EST`, or `!schedule September 1 8:00 PM EST`.',
    '2. The bot detects the timezone, records the proposed time, and pings the other team role.',
    '3. The other team captain posts `!accept` to confirm or `!decline` to reject.',
    `4. After \`!accept\`, ${adminNotificationLine}`,
    '',
    '**Other commands**',
    '`!propose July 28 8:00 PM EST` - same as `!schedule`',
    '`!reschedule July 29 8:00 PM EST` - captain requests a new time',
    'Reschedules must stay inside the round window. Reschedules within 24 hours of match time require admin override.',
    isGroupStageMatch(match)
      ? 'Group Stage note: teams may reschedule matches within their round window by mutual agreement.'
      : null,
    `Roster changes: go to ${ticketChannel}.`,
    '',
    '**Admin Help**',
    '`!calladmin reason here` - alerts admins with this match channel and FACEIT link'
  ].filter((line) => line !== null).join('\n');
}

function getAdminNotificationLine(channel) {
  const destination = config.adminScheduleChannelId
    ? `<#${config.adminScheduleChannelId}>`
    : 'this match channel';

  return `admins are notified in ${destination} and Match Staff/Producers are pinged to schedule it on FACEIT.`;
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
    const rawRound = Number(match.raw?.round ?? match.raw?.round_number);
    if (rawRound === 1) return seasonWindow('Round 1');
    if (rawRound === 2) return seasonWindow('Round 2');
    if (rawRound === 3) return seasonWindow('Round 3');
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

async function getAdminAlertChannel(guild) {
  if (!config.adminScheduleChannelId) return null;
  return guild.channels.fetch(config.adminScheduleChannelId).catch(() => null);
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
    ? await interaction.guild.channels.fetch(stored.discord.channelId).catch(() => null)
    : null;

  if (matchChannel) {
    await matchChannel.send([
      approved ? '**Admin approved schedule request.**' : '**Admin denied schedule request.**',
      `Time: **${formatProposalTime(proposal)}**`,
      `Admin: <@${interaction.user.id}>`
    ].join('\n'));
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

  return config.matchAccessRoleNames.some((roleName) =>
    member.roles.cache.some((role) => role.name.toLowerCase() === roleName.toLowerCase())
  ) || config.matchAccessRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

function validateScheduleRequest(stored, proposedText, kind, parsedDate = null) {
  const proposedDate = parsedDate || parseScheduleText(proposedText);
  const window = getScheduleWindowForMatch(stored.match);
  const result = {
    allowed: true,
    warning: null,
    roundWindowMessage: window
      ? `Round window: **${window.start} to ${window.end}**`
      : 'Round window: **not configured; admins must verify manually**'
  };

  if (window && proposedDate) {
    const start = parseScheduleText(`${window.start} 12:00 AM EST`);
    const end = parseScheduleText(`${window.end} 11:59 PM EST`);
    if (start && end && (proposedDate < start || proposedDate > end)) {
      return {
        ...result,
        allowed: false,
        message: `That time is outside the ${stored.match.round} window (${window.start} to ${window.end}). Ask an admin if you need an exception.`
      };
    }
  }

  if (kind === 'reschedule' && isWithin24Hours(stored)) {
    result.warning = 'Inside 24 hours of match time. Admin override required.';
  }

  if (window && !proposedDate) {
    result.warning = 'I could not read that date automatically. Admins must verify it is inside the round window.';
  }

  return result;
}

function getScheduleWindowForMatch(match) {
  const configuredWindow = config.roundWindows[match.round.toLowerCase()];
  if (configuredWindow) return configuredWindow;

  const roundInfo = getSeasonRoundInfo(match);
  if (!roundInfo) return null;

  return {
    start: roundInfo.start,
    end: roundInfo.end
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

function isCaptain(member) {
  return member.roles.cache.some((role) =>
    role.name.toLowerCase() === config.teamCaptainRoleName.toLowerCase()
  );
}

function nextDateOptions() {
  const options = [];
  const formatter = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });

  for (let offset = 0; offset < 14; offset += 1) {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    const value = date.toISOString().slice(0, 10);
    const prefix = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : formatter.format(date);
    options.push({
      label: `${prefix} (${value})`,
      value
    });
  }

  return options;
}

function timeOptions() {
  const times = [
    '5:00 PM',
    '5:30 PM',
    '6:00 PM',
    '6:30 PM',
    '7:00 PM',
    '7:30 PM',
    '8:00 PM',
    '8:30 PM',
    '9:00 PM',
    '9:30 PM',
    '10:00 PM',
    '10:30 PM',
    '11:00 PM',
    '11:30 PM'
  ];

  return times.map((time) => ({ label: time, value: time }));
}

function formatDateLabel(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(year, month - 1, day));
}

function acceptButton(proposalId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`schedule_accept:${proposalId}`)
      .setLabel('Accept schedule')
      .setStyle(ButtonStyle.Success)
  );
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
