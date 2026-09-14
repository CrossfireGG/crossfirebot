import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  REST,
  Routes
} from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';

import { commands } from './commands.js';
import { getConfig } from './config.js';
import { FaceitClient } from './faceit.js';
import { SclClient } from './scl.js';
import { findUniqueSclMatchChannel } from './sclChannelResolver.js';
import { makeMatchChannelName, provisionMatchChannel, repairMatchChannel, resolveTeamRole, updateMatchChannelName } from './discordProvision.js';
import {
  acceptScheduleProposal,
  approveScheduleProposal,
  denyScheduleProposal,
  declineScheduleProposal,
  getLatestOpenScheduleProposalForMatch,
  getSchedule,
  getSclDiscordMessage,
  getStoredMatch,
  getStoredMatchByChannel,
  listStoredMatches,
  saveMatch,
  saveMatchIntroMessageId,
  savePostedSclDemo,
  saveSclDiscordMessage,
  saveSchedule,
  saveScheduleProposal
} from './store.js';
import { scheduleFaceitMatch } from './faceitSchedule.js';
import { auditMissingCaptains, auditMissingPlayers, syncRolesFromSheet } from './sheetRoles.js';
import { startWebhookServer } from './webhookServer.js';

const config = getConfig();
const lockPath = path.resolve('bot.lock');
claimSingleInstance(lockPath);

const faceit = new FaceitClient(
  config.faceitApiKey,
  config.faceitSources
);
const scl = new SclClient(config.sclApiKey);
const sclMessageUpdateQueues = new Map();
let webhookServer = null;

const PENDING_SCHEDULE_TOPIC_PREFIX = 'Pending schedule:';
const EMBED_COLORS = {
  proposed: 0xf1c40f,
  accepted: 0x2ecc71,
  declined: 0xe74c3c,
  admin: 0x3498db,
  warning: 0xe67e22
};

const SEASON_SCHEDULE = [
  { name: 'Group Stage', start: 'August 31, 2026', end: 'September 8, 2026', defaultDate: 'September 4, 2026' },
  { name: 'Round 1', start: 'August 31, 2026', end: 'September 2, 2026', defaultDate: 'September 1, 2026' },
  { name: 'Round 2', start: 'September 3, 2026', end: 'September 5, 2026', defaultDate: 'September 4, 2026' },
  { name: 'Round 3', start: 'September 6, 2026', end: 'September 8, 2026', defaultDate: 'September 7, 2026' },
  { name: 'Seeding Break', start: 'September 9, 2026', end: 'September 11, 2026', defaultDate: 'September 10, 2026' },
  { name: 'Playoff Stage', start: 'September 12, 2026', end: 'October 11, 2026', defaultDate: 'September 26, 2026' },
  { name: 'Upper Bracket - Round 1', start: 'September 12, 2026', end: 'September 14, 2026', defaultDate: 'September 14, 2026', defaultDateTime: 'Mon, 14 Sep 2026, 20:00 EDT' },
  { name: 'Upper Bracket - Round 2', start: 'September 15, 2026', end: 'September 17, 2026', defaultDate: 'September 16, 2026', defaultDateTime: 'Wed, 16 Sep 2026, 20:00 EDT' },
  { name: 'Lower Bracket - Round 1', start: 'September 15, 2026', end: 'September 17, 2026', defaultDate: 'September 16, 2026', defaultDateTime: 'Wed, 16 Sep 2026, 20:00 EDT' },
  { name: 'Upper Bracket - Round 3', start: 'September 18, 2026', end: 'September 20, 2026', defaultDate: 'September 19, 2026', defaultDateTime: 'Sat, 19 Sep 2026, 20:00 EDT' },
  { name: 'Lower Bracket - Round 2', start: 'September 18, 2026', end: 'September 20, 2026', defaultDate: 'September 19, 2026', defaultDateTime: 'Sat, 19 Sep 2026, 20:00 EDT' },
  { name: 'Lower Bracket - Round 3', start: 'September 21, 2026', end: 'September 23, 2026', defaultDate: 'September 22, 2026', defaultDateTime: 'Tue, 22 Sep 2026, 20:00 EDT' },
  { name: 'Upper Bracket - Round 4', start: 'September 24, 2026', end: 'September 26, 2026', defaultDate: 'September 25, 2026', defaultDateTime: 'Fri, 25 Sep 2026, 20:00 EDT' },
  { name: 'Lower Bracket - Round 4', start: 'September 24, 2026', end: 'September 26, 2026', defaultDate: 'September 25, 2026', defaultDateTime: 'Fri, 25 Sep 2026, 20:00 EDT' },
  { name: 'Lower Bracket - Round 5', start: 'September 27, 2026', end: 'September 29, 2026', defaultDate: 'September 28, 2026', defaultDateTime: 'Mon, 28 Sep 2026, 20:00 EDT' },
  { name: 'Upper Bracket - Round 5', start: 'September 30, 2026', end: 'October 2, 2026', defaultDate: 'October 1, 2026', defaultDateTime: 'Thu, 01 Oct 2026, 20:00 EDT' },
  { name: 'Lower Bracket - Round 6', start: 'September 30, 2026', end: 'October 2, 2026', defaultDate: 'October 1, 2026', defaultDateTime: 'Thu, 01 Oct 2026, 20:00 EDT' },
  { name: 'Lower Bracket - Round 7', start: 'October 3, 2026', end: 'October 5, 2026', defaultDate: 'October 4, 2026', defaultDateTime: 'Sun, 04 Oct 2026, 20:00 EDT' },
  { name: 'Lower Bracket - Round 8', start: 'October 6, 2026', end: 'October 8, 2026', defaultDate: 'October 7, 2026', defaultDateTime: 'Wed, 07 Oct 2026, 20:00 EDT' },
  { name: 'Grand Final (BO5)', start: 'October 9, 2026', end: 'October 11, 2026', defaultDate: 'October 10, 2026', defaultDateTime: 'Saturday, 10 Oct 2026, 20:00 EDT' }
];

const PLAYOFF_ROUND_FILTERS = {
  'upper-r1': {
    label: 'Upper Bracket - Round 1',
    categories: ['Upper Bracket - Round 1', 'WB Round of 32']
  },
  'upper-r2-lower-r1': {
    label: 'Upper Bracket - Round 2 + Lower Bracket - Round 1',
    categories: ['Upper Bracket - Round 2', 'Lower Bracket - Round 1', 'WB Round of 16', 'Losers Round 1']
  },
  'upper-r3-lower-r2': {
    label: 'Upper Bracket - Round 3 + Lower Bracket - Round 2',
    categories: ['Upper Bracket - Round 3', 'Lower Bracket - Round 2', 'WB Quarterfinals', 'Losers Round 2']
  },
  'lower-r3': {
    label: 'Lower Bracket - Round 3',
    categories: ['Lower Bracket - Round 3', 'Losers Round 3']
  },
  'upper-r4-lower-r4': {
    label: 'Upper Bracket - Round 4 + Lower Bracket - Round 4',
    categories: ['Upper Bracket - Round 4', 'Lower Bracket - Round 4', 'WB Semifinals', 'Losers Round 4']
  },
  'lower-r5': {
    label: 'Lower Bracket - Round 5',
    categories: ['Lower Bracket - Round 5', 'Losers Round 5']
  },
  'upper-r5-lower-r6': {
    label: 'Upper Bracket - Round 5 + Lower Bracket - Round 6',
    categories: ['Upper Bracket - Round 5', 'Lower Bracket - Round 6', 'WB Final', 'Losers Round 6']
  },
  'lower-r7': {
    label: 'Lower Bracket - Round 7',
    categories: ['Lower Bracket - Round 7', 'Losers Round 7']
  },
  'lower-r8': {
    label: 'Lower Bracket - Round 8',
    categories: ['Lower Bracket - Round 8', 'Lower Bracket - Final', 'Losers Final']
  },
  'lower-final': {
    label: 'Lower Bracket - Round 8',
    categories: ['Lower Bracket - Round 8', 'Lower Bracket - Final', 'Losers Final']
  },
  'wb-r32': {
    label: 'Upper Bracket - Round 1',
    categories: ['Upper Bracket - Round 1', 'WB Round of 32']
  },
  'wb-r16-lb-r1': {
    label: 'Upper Bracket - Round 2 + Lower Bracket - Round 1',
    categories: ['Upper Bracket - Round 2', 'Lower Bracket - Round 1', 'WB Round of 16', 'Losers Round 1']
  },
  'wb-qf-lb-r2': {
    label: 'Upper Bracket - Round 3 + Lower Bracket - Round 2',
    categories: ['Upper Bracket - Round 3', 'Lower Bracket - Round 2', 'WB Quarterfinals', 'Losers Round 2']
  },
  'lb-r3': {
    label: 'Lower Bracket - Round 3',
    categories: ['Lower Bracket - Round 3', 'Losers Round 3']
  },
  'wb-sf-lb-r4': {
    label: 'Upper Bracket - Round 4 + Lower Bracket - Round 4',
    categories: ['Upper Bracket - Round 4', 'Lower Bracket - Round 4', 'WB Semifinals', 'Losers Round 4']
  },
  'lb-r5': {
    label: 'Lower Bracket - Round 5',
    categories: ['Lower Bracket - Round 5', 'Losers Round 5']
  },
  'wb-final-lb-r6': {
    label: 'Upper Bracket - Round 5 + Lower Bracket - Round 6',
    categories: ['Upper Bracket - Round 5', 'Lower Bracket - Round 6', 'WB Final', 'Losers Round 6']
  },
  'lb-r7': {
    label: 'Lower Bracket - Round 7',
    categories: ['Lower Bracket - Round 7', 'Losers Round 7']
  },
  'lb-final': {
    label: 'Lower Bracket - Round 8',
    categories: ['Lower Bracket - Round 8', 'Lower Bracket - Final', 'Losers Final']
  },
  'grand-final': {
    label: 'Grand Final (BO5)',
    categories: ['Grand Final', 'Grand Final (BO5)']
  }
};

const SEASON6_WB_ROUND_OF_32_MATCHES = [
  ['Chicken Coop Esports', 'Mylifebelike'],
  ['Detonate', 'Arctic Ace'],
  ['Zomblers', 'Olympus'],
  ['EMPIRE', 'BucketJonsBoys'],
  ['LAG', 'Overtake Sector'],
  ['F5 Esports', 'Atlantis Esports'],
  ['Villainous', 'New Legends'],
  ['Wanted Goons', 'Unreal Nightmare'],
  ['Marsborne', 'Fathom Gaming'],
  ['Club 333', 'KODEX Esports'],
  ['Iowa Stormboar', 'Omen Esports'],
  ['Farmville', 'Celestial Esports'],
  ['Regain', 'Addice'],
  ['BabaG', 'FlyQuest Red'],
  ['Nutorious', 'North Forge'],
  ['Without a Roof', 'Beyond Limits']
];
const SEASON6_WB_ROUND_OF_32_PAIR_ORDER = new Map(
  SEASON6_WB_ROUND_OF_32_MATCHES.map(([teamA, teamB], index) => [matchPairKey(teamA, teamB), index])
);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.Reaction
  ]
});

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
  console.log('Slash commands registered');

  if (!webhookServer) {
    webhookServer = startWebhookServer(config, {
      onSclDemoReady: handleSclDemoReady
    });
  }
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

    if (interaction.isButton() && interaction.customId.startsWith('calladmin_claim:')) {
      await handleCallAdminClaim(interaction);
    }
  } catch (error) {
    console.error(error);
    const message = `Something failed: ${error.message}`;
    await safelyRespondToInteraction(interaction, message);
  }
});

async function handleAdminCommand(interaction) {
  if (interaction.commandName === 'cf') {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'sync') {
      const target = interaction.options.getString('target', true);
      if (target === 'matches') {
        await handleSyncMatches(interaction);
        return;
      }
      if (target === 'teams') {
        await handleSyncTeamRoles(interaction);
        return;
      }
    }

    if (subcommand === 'audit') {
      const target = interaction.options.getString('target', true);
      if (target === 'matches') {
        await handleAuditMatches(interaction);
        return;
      }
      if (target === 'players') {
        await handleMissingPlayers(interaction);
        return;
      }
      if (target === 'captains') {
        await handleMissingCaptains(interaction);
        return;
      }
    }

    if (subcommand === 'refresh') {
      await handleRefreshMatchStatuses(interaction);
      return;
    }

    if (subcommand === 'status') {
      await handleBotStatus(interaction);
      return;
    }

    if (subcommand === 'commands') {
      await handleCommandHelp(interaction);
      return;
    }

    if (subcommand === 'create') {
      await handleCreateMatchChat(interaction);
      return;
    }

    if (subcommand === 'sample') {
      await handleSampleMatch(interaction);
      return;
    }
  }

  if (interaction.commandName === 'matches') {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'sync') {
      await handleSyncMatches(interaction);
      return;
    }

    if (subcommand === 'status') {
      await handleBotStatus(interaction);
      return;
    }

    if (subcommand === 'refresh-status') {
      await handleRefreshMatchStatuses(interaction);
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

  if (interaction.commandName === 'matchchat') {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'create') {
      await handleCreateMatchChat(interaction);
      return;
    }
  }

  await interaction.reply({ content: 'Unknown command.', ephemeral: true });
}

async function handleBotStatus(interaction) {
  const matches = await listStoredMatches();
  await interaction.reply({ content: `I know about ${matches.length} match(es).`, ephemeral: true });
}

async function handleCommandHelp(interaction) {
  await interaction.reply({
    content: [
      '**CROSSFIRE Admin Commands**',
      '`/cf sync target:matches` - create/update FACEIT match rooms.',
      '`/cf sync target:matches round:Upper Bracket - Round 1` - sync one playoff round window only.',
      '`/cf sync target:teams` - sync roles, captains, participants, and nicknames from the sheet.',
      '`/cf sync target:teams notify_captains:true` - also DM captains about missing players.',
      '`/cf audit target:matches` - check match rooms and permissions without creating channels.',
      '`/cf audit target:matches fix:true` - repair channel names, links, pins, and permissions.',
      '`/cf audit target:players` - show sheet players missing from Discord.',
      '`/cf audit target:captains` - show missing captains.',
      '`/cf refresh` - refresh status emojis on existing match channels.',
      '`/cf status` - show how many matches the bot knows.',
      '`/cf create link:<FACEIT room link>` - create/update one match room.',
      '`/cf sample` - create a sample match room for testing.',
      '',
      '**Match Room Commands**',
      '`!schedule September 14 8 PM EDT` - propose a match time.',
      '`!propose September 14 8 PM EDT` - same as `!schedule`.',
      '`!reschedule September 14 9 PM EDT` - request a new time.',
      '`!accept` - accept the open proposal from the other team.',
      '`!decline` - decline the open proposal.',
      '`!admin reason here` or `!calladmin reason here` - alert admins with this match room and FACEIT link.'
    ].join('\n'),
    ephemeral: true
  });
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

    if (/^!(calladmin|admin)\b/i.test(content)) {
      await handleCallAdmin(message, content);
    }
  } catch (error) {
    console.error(error);
    await message.reply(truncateDiscordMessage(`Something failed: ${error.message}`));
  }
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  try {
    await syncMirroredRoles(oldMember, newMember);
  } catch (error) {
    console.error('Role sync failed:', error);
  }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    await handleCallAdminReaction(reaction, user);
  } catch (error) {
    console.error('Call admin reaction failed:', error);
  }
});

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  for (const guildId of config.commandGuildIds) {
    try {
      await rest.put(
        Routes.applicationGuildCommands(config.discordClientId, guildId),
        { body: commands }
      );
      console.log(`Slash commands registered for guild ${guildId}`);
    } catch (error) {
      console.error(`Could not register slash commands for guild ${guildId}:`, error);
    }
  }
}

async function syncMirroredRoles(oldMember, newMember) {
  for (const pair of config.roleSyncPairs) {
    await syncMirroredRoleSide(oldMember, newMember, pair.left, pair.right);
    await syncMirroredRoleSide(oldMember, newMember, pair.right, pair.left);
  }
}

async function syncMirroredRoleSide(oldMember, newMember, source, target) {
  if (newMember.guild.id !== source.guildId) return;

  const hadRole = oldMember.roles.cache.has(source.roleId);
  const hasRole = newMember.roles.cache.has(source.roleId);
  if (hadRole === hasRole) return;

  const targetGuild = await client.guilds.fetch(target.guildId).catch(() => null);
  if (!targetGuild) return;

  const targetMember = await targetGuild.members.fetch(newMember.id).catch(() => null);
  if (!targetMember) return;

  const targetHasRole = targetMember.roles.cache.has(target.roleId);
  if (hasRole && !targetHasRole) {
    await targetMember.roles.add(target.roleId, 'Mirrored Production role from linked server');
  }
  if (!hasRole && targetHasRole) {
    await targetMember.roles.remove(target.roleId, 'Mirrored Production role from linked server');
  }
}

async function handleSclDemoReady(event) {
  const matchId = String(event.match_id || '').trim();
  const mapNumber = Number(event.map_number);
  if (event.provider !== 'faceit' || !matchId || !Number.isInteger(mapNumber) || mapNumber < 1) {
    console.log(`[SCL] ignored invalid demo_ready event provider=${event.provider || 'unknown'} match_id=${matchId || 'unknown'} map_number=${event.map_number ?? 'unknown'}`);
    return;
  }

  const retryDelays = [30_000, 300_000];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const sclMatch = await scl.getFaceitMatch(matchId);
      const map = (sclMatch.maps || []).find((candidate) => Number(candidate.map_number) === mapNumber);
      if (!map || map.status !== 'ready' || !map.viewer_url) {
        const reason = !map ? 'matching map missing' : `map status=${map.status || 'unknown'} viewer_url=${map.viewer_url ? 'present' : 'missing'}`;
        if (attempt < 3) {
          const delay = retryDelays[attempt - 1];
          console.log(`[SCL] ${reason}; retrying match_id=${matchId} map_number=${mapNumber} attempt=${attempt + 1} in=${delay}ms`);
          await sleep(delay);
          continue;
        }
        console.error(`[SCL] giving up: ${reason} match_id=${matchId} map_number=${mapNumber} attempts=${attempt}`);
        return;
      }

      await queueSclMessageUpdate(matchId, () => postSclMapsToDiscord(matchId, mapNumber, sclMatch));
      return;
    } catch (error) {
      if (!error.retryable || attempt >= 3) {
        const terminalCode = error.code || error.status || 'UNKNOWN';
        console.error(`[SCL] GET failed terminally match_id=${matchId} map_number=${mapNumber} code=${terminalCode} attempt=${attempt}: ${error.message}`);
        return;
      }

      const delay = retryDelays[attempt - 1];
      console.warn(`[SCL] transient GET failure match_id=${matchId} map_number=${mapNumber} code=${error.code || error.status || 'UNKNOWN'} attempt=${attempt}; retrying in=${delay}ms`);
      await sleep(delay);
    }
  }
}

async function postSclMapsToDiscord(matchId, mapNumber, sclMatch) {
  const stored = await resolveStoredSclMatch(matchId, sclMatch);
  if (!stored?.discord?.channelId) {
    console.error(`[SCL] no Discord channel found match_id=${matchId} map_number=${mapNumber}`);
    return;
  }

  const channel = await client.channels.fetch(stored.discord.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) {
    console.error(`[SCL] Discord channel unavailable match_id=${matchId} channel_id=${stored.discord.channelId}`);
    return;
  }

  const readyMaps = (sclMatch.maps || [])
    .filter((map) => map.status === 'ready' && map.viewer_url)
    .sort((left, right) => Number(left.map_number) - Number(right.map_number));
  if (!readyMaps.length) {
    console.error(`[SCL] no ready maps to post match_id=${matchId} event_map_number=${mapNumber}`);
    return;
  }

  const payload = { embeds: [sclDemoReadyEmbed(stored, sclMatch, readyMaps)] };
  const savedMessage = await getSclDiscordMessage(matchId);
  const existingMessage = savedMessage?.channelId === channel.id
    ? await channel.messages.fetch(savedMessage.messageId).catch(() => null)
    : null;

  let message;
  if (existingMessage) {
    message = await existingMessage.edit(payload);
    console.log(`[SCL] combined message updated match_id=${matchId} maps=${readyMaps.map((map) => map.map_number).join(',')} channel_id=${channel.id} message_id=${message.id}`);
  } else {
    message = await channel.send(payload);
    await saveSclDiscordMessage(matchId, channel.id, message.id);
    console.log(`[SCL] combined message posted match_id=${matchId} maps=${readyMaps.map((map) => map.map_number).join(',')} channel_id=${channel.id} message_id=${message.id}`);
  }

  for (const readyMap of readyMaps) {
    await savePostedSclDemo(matchId, readyMap);
  }

  await markMatchChannelFinishedFromScl(channel, stored, sclMatch);
}

async function queueSclMessageUpdate(matchId, update) {
  const previous = sclMessageUpdateQueues.get(matchId) || Promise.resolve();
  const current = previous.catch(() => null).then(update);
  sclMessageUpdateQueues.set(matchId, current);
  try {
    return await current;
  } finally {
    if (sclMessageUpdateQueues.get(matchId) === current) {
      sclMessageUpdateQueues.delete(matchId);
    }
  }
}

async function resolveStoredSclMatch(matchId, sclMatch) {
  const exact = await getStoredMatch(matchId);
  if (exact?.discord?.channelId) return exact;

  const teamNames = (sclMatch.teams || []).map((team) => normalizeSclTeamName(team?.name)).filter(Boolean);
  if (teamNames.length < 2) return exact;

  const storedMatches = await listStoredMatches();
  const fallback = storedMatches.find((entry) => {
    if (!entry?.discord?.channelId) return false;
    const storedNames = [entry.match?.teamA, entry.match?.teamB].map(normalizeSclTeamName).filter(Boolean);
    return storedNames.length === 2 && storedNames.every((name) => teamNames.includes(name));
  });
  if (fallback) {
    console.warn(`[SCL] resolved Discord channel by team-name fallback match_id=${matchId} channel_id=${fallback.discord.channelId}`);
    return fallback;
  }

  const guild = await client.guilds.fetch(config.discordGuildId).catch(() => null);
  if (!guild) {
    console.error(`[SCL] configured Discord guild unavailable guild_id=${config.discordGuildId}`);
    return exact;
  }

  const channels = await guild.channels.fetch().catch(() => null);
  if (!channels) {
    console.error(`[SCL] could not fetch Discord channels guild_id=${guild.id}`);
    return exact;
  }

  const displayTeamNames = (sclMatch.teams || []).map((team) => String(team?.name || '').trim()).filter(Boolean);
  const result = findUniqueSclMatchChannel(channels.values(), displayTeamNames);
  if (!result.channel) {
    if (result.matchCount > 1) {
      console.error(`[SCL] team-name channel lookup ambiguous match_id=${matchId} teams=${displayTeamNames.join(' vs ')} matches=${result.matchCount}`);
    }
    return exact;
  }

  const recovered = {
    id: matchId,
    teamA: displayTeamNames[0],
    teamB: displayTeamNames[1],
    faceitUrl: `https://www.faceit.com/en/cs2/room/${matchId}`
  };
  const discordIds = {
    channelId: result.channel.id,
    categoryId: result.channel.parentId || null
  };
  await saveMatch(recovered, discordIds);
  console.warn(`[SCL] resolved actual Discord channel by name and saved match mapping match_id=${matchId} channel_id=${result.channel.id} channel_name=${result.channel.name}`);
  return { match: recovered, discord: discordIds };
}

function normalizeSclTeamName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sclDemoReadyEmbed(stored, sclMatch, maps) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('SCL 2D Demo Review')
    .setDescription(`**${stored.match.teamA} vs ${stored.match.teamB}**`)
    .addFields([
      ...maps.map((map) => ({
        name: `Map ${map.map_number}${map.map_name ? ` — ${map.map_name}` : ''}`,
        value: sclMapLinkLine(map),
        inline: false
      })),
      { name: 'Series Status', value: sclMatch.status || 'Unknown', inline: true },
      stored.match.faceitUrl ? { name: 'FACEIT Match Room', value: `[Open match room](${stored.match.faceitUrl})`, inline: true } : null
    ].filter(Boolean))
    .setTimestamp(new Date());
}

function sclMapLinkLine(map) {
  const score = Number.isInteger(map.team1_score) && Number.isInteger(map.team2_score)
    ? ` • Score: ${map.team1_score}–${map.team2_score}`
    : '';
  const expires = map.expires_at
    ? ` • Expires ${discordTimestamp(new Date(Number(map.expires_at) * 1000).toISOString(), 'R')}`
    : '';
  return `[Watch Map ${map.map_number} in the SCL viewer](${map.viewer_url})${score}${expires}`;
}

async function markMatchChannelFinishedFromScl(channel, stored, sclMatch) {
  const finishedMatch = {
    ...stored.match,
    status: 'scl_demo_ready',
    scheduledByDiscord: false
  };
  const renameResult = await updateMatchChannelName(channel, finishedMatch);
  if (renameResult.error) {
    console.error(`[SCL] failed to mark Discord channel green match_id=${stored.match.id} channel_id=${channel.id}: ${renameResult.error.message}`);
  } else if (renameResult.changed) {
    console.log(`[SCL] marked Discord channel green match_id=${stored.match.id} channel_id=${channel.id} name=${renameResult.name}`);
  }

  await saveMatch({
    ...finishedMatch,
    sclStatus: sclMatch.status || null
  }, stored.discord);
}

async function handleCallAdminReaction(reaction, user) {
  if (user.bot) return;

  const fullReaction = reaction.partial
    ? await reaction.fetch().catch(() => null)
    : reaction;
  if (!fullReaction) return;

  const message = fullReaction.message.partial
    ? await fullReaction.message.fetch().catch(() => null)
    : fullReaction.message;
  if (!message || message.channelId !== config.callAdminChannelId) return;
  if (!isCallAdminAlertMessage(message)) return;

  const adminMember = await message.guild.members.fetch(user.id).catch(() => null);
  if (!adminMember || !isAdminStaff(adminMember)) return;

  const matchChannelId = extractDiscordChannelIdFromMessage(message);
  if (!matchChannelId) return;

  const matchChannel = await client.channels.fetch(matchChannelId).catch(() => null);
  if (!matchChannel?.isTextBased?.()) return;

  await sendCallAdminClaimToMatchChannel(matchChannel, user.id);
}

async function handleCallAdminClaim(interaction) {
  await interaction.deferReply({ ephemeral: true });

  if (!isAdminStaff(interaction.member)) {
    await interaction.editReply('Only match staff/admins can claim calladmin tickets.');
    return;
  }

  const [, channelId] = interaction.customId.split(':');
  const matchChannelId = channelId || extractDiscordChannelIdFromMessage(interaction.message);
  if (!matchChannelId) {
    await interaction.editReply('I could not find the match channel for this calladmin ticket.');
    return;
  }

  const matchChannel = await client.channels.fetch(matchChannelId).catch(() => null);
  if (!matchChannel?.isTextBased?.()) {
    await interaction.editReply('I could not open the match channel for this calladmin ticket.');
    return;
  }

  await sendCallAdminClaimToMatchChannel(matchChannel, interaction.user.id);
  await interaction.message.react('✅').catch(() => null);
  await interaction.message.edit({
    components: [callAdminClaimButton(matchChannelId, true)]
  }).catch(() => null);
  await interaction.editReply('Claimed. I posted in the match chat that you are looking into it.');
}

async function sendCallAdminClaimToMatchChannel(matchChannel, adminId) {
  await matchChannel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(EMBED_COLORS.admin)
        .setTitle('Admin Is Looking Into This')
        .setDescription(`<@${adminId}> has claimed the admin request for this match.`)
        .setTimestamp(new Date())
    ],
    allowedMentions: {
      users: [adminId],
      roles: [],
      repliedUser: false
    }
  });
}

function extractDiscordChannelId(value) {
  const mention = String(value || '').match(/<#(\d{15,25})>/);
  return mention ? mention[1] : '';
}

function extractDiscordChannelIdFromMessage(message) {
  const contentMatch = extractDiscordChannelId(message.content);
  if (contentMatch) return contentMatch;

  for (const embed of message.embeds || []) {
    const field = embed.fields?.find((candidate) =>
      candidate.name?.toLowerCase() === 'discord channel' ||
      candidate.name?.toLowerCase() === 'discord match chat'
    );
    const fieldMatch = extractDiscordChannelId(field?.value);
    if (fieldMatch) return fieldMatch;
  }

  return '';
}

function isCallAdminAlertMessage(message) {
  if (String(message.content || '').includes('ADMIN HELP REQUESTED')) return true;
  return (message.embeds || []).some((embed) =>
    String(embed.title || '').toLowerCase().includes('admin help requested')
  );
}

async function handleSyncMatches(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const roundFilter = getRequestedRoundFilter(interaction);

  const guild = await client.guilds.fetch(config.discordGuildId);
  await guild.channels.fetch();
  await guild.roles.fetch();

  const allMatches = (await faceit.getMatches()).map(normalizeSeason6PlayoffMatch);
  const matches = filterAndSortMatchesForSync(allMatches, roundFilter);
  let created = 0;
  let skipped = 0;

  for (const match of matches) {
    if (!match.teamA || !match.teamB) {
      skipped += 1;
      continue;
    }

    const matchForDiscord = clearDiscordScheduleStatus(match);
    const discordIds = await provisionMatchChannel(guild, config, matchForDiscord);
    await saveMatch(matchForDiscord, discordIds);

    const channel = await guild.channels.fetch(discordIds.channelId);
    await upsertMatchIntroMessage(channel, matchForDiscord);

    created += 1;
  }

  const roundText = roundFilter?.label || 'all detected rounds';
  const coverage = summarizeSyncCoverage(matches);
  await interaction.editReply(truncateDiscordMessage([
    `Synced ${created} match channel(s) for ${roundText}. Skipped ${skipped}.`,
    coverage
  ].filter(Boolean).join('\n')));
}

async function handleRefreshMatchStatuses(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const guild = await client.guilds.fetch(config.discordGuildId);
  await guild.channels.fetch();

  const matches = (await faceit.getMatches()).map(normalizeSeason6PlayoffMatch);
  const result = {
    checked: matches.length,
    found: 0,
    renamed: 0,
    finished: 0,
    scheduled: 0,
    missing: 0,
    failures: []
  };

  for (const match of matches) {
    try {
      const stored = await getStoredMatch(match.id);
      let channel = stored?.discord?.channelId
        ? await guild.channels.fetch(stored.discord.channelId).catch(() => null)
        : null;
      if (!channel?.isTextBased?.()) {
        channel = findAuditMatchChannel(guild, match, makeMatchChannelName(match));
      }

      if (!channel?.isTextBased?.()) {
        result.missing += 1;
        continue;
      }

      result.found += 1;
      const storedByChannel = await getStoredMatchByChannel(channel.id);
      const storedRecord = stored || storedByChannel;
      const faceitStatus = String(match.status || '').toLowerCase();
      const storedStatus = String(storedRecord?.match?.status || '').toLowerCase();
      const savedSchedule = await getSchedule(match.id) ||
        (storedRecord?.match?.id && storedRecord.match.id !== match.id
          ? await getSchedule(storedRecord.match.id)
          : null);
      const wasMarkedScheduled = hasScheduledChannelPrefix(channel.name);
      const wasMarkedFinished = hasFinishedChannelPrefix(channel.name);
      const hasApprovedScheduleMessage = wasMarkedScheduled
        ? true
        : await channelHasApprovedScheduleMessage(channel, match);
      const matchForStatus = {
        ...match,
        scheduledByDiscord: Boolean(
          storedRecord?.match?.scheduledByDiscord ||
          savedSchedule ||
          wasMarkedScheduled ||
          hasApprovedScheduleMessage
        ),
        status: refreshStatusWithStoredState(match.status, storedStatus, wasMarkedFinished)
      };
      const previousName = channel.name;
      const nextName = makeMatchChannelName(matchForStatus);
      const renameResult = await updateMatchChannelName(channel, matchForStatus);
      if (renameResult.changed) {
        result.renamed += 1;
        console.log(`[FACEIT status] channel renamed match_id=${match.id} from=${previousName} to=${renameResult.name || nextName}`);
      }

      const status = String(matchForStatus.status || '').toLowerCase();
      if (['finished', 'done', 'completed', 'cancelled'].some((value) => status.includes(value))) {
        result.finished += 1;
      } else if (matchForStatus.scheduledByDiscord || status === 'discord_scheduled') {
        result.scheduled += 1;
      }

      await saveMatch(matchForStatus, {
        ...(storedRecord?.discord || {}),
        channelId: channel.id,
        categoryId: channel.parentId || storedRecord?.discord?.categoryId || null
      });
    } catch (error) {
      result.failures.push(`${match.teamA} vs ${match.teamB}: ${error.message}`);
      console.error(`[FACEIT status] refresh failed match_id=${match.id}`, error);
    }
  }

  const failureLines = result.failures.slice(0, 5).map((failure) => `- ${truncateText(failure, 180)}`);
  await interaction.editReply(truncateDiscordMessage([
    `Checked ${result.checked} FACEIT match(es) and found ${result.found} Discord channel(s).`,
    `Renamed: ${result.renamed}. Finished/green: ${result.finished}. Scheduled/yellow: ${result.scheduled}. Missing channels: ${result.missing}. Failures: ${result.failures.length}.`,
    failureLines.length ? ['Failures:', ...failureLines].join('\n') : null,
    result.failures.length > failureLines.length ? `...and ${result.failures.length - failureLines.length} more failure(s).` : null
  ].filter(Boolean).join('\n')));
}

async function handleAuditMatches(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const roundFilter = getRequestedRoundFilter(interaction);
  const shouldFix = interaction.options.getBoolean('fix') || false;
  const guild = await client.guilds.fetch(config.discordGuildId);
  await guild.channels.fetch();
  await guild.roles.fetch();

  const matches = filterAndSortMatchesForSync((await faceit.getMatches()).map(normalizeSeason6PlayoffMatch), roundFilter);
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
        if (audit.missingChannel) {
          result.problems.push(`${match.teamA} vs ${match.teamB}: missing channel; run /cf sync target:matches to create it`);
          continue;
        }

        const matchForDiscord = clearDiscordScheduleStatus(match);
        const discordIds = await repairMatchChannel(guild, config, audit.channel, matchForDiscord);
        await saveMatch(matchForDiscord, discordIds);
        const repairedChannel = await guild.channels.fetch(discordIds.channelId).catch(() => audit.channel);
        if (repairedChannel?.isTextBased?.()) {
          await upsertMatchIntroMessage(repairedChannel, matchForDiscord);
        }
        result.fixed += 1;
      } catch (error) {
        result.problems.push(`${match.teamA} vs ${match.teamB}: fix failed - ${error.message}`);
      }
    } else {
      result.problems.push(`${match.teamA} vs ${match.teamB}: ${audit.problems.join('; ')}`);
    }
  }

  const roundText = roundFilter?.label || 'all detected rounds';
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
    shouldFix ? 'Run `/cf audit target:matches` again without fix to verify everything is clean.' : 'Use `/cf audit target:matches fix:true` to repair channel names, links, and permissions without intentionally duplicating existing match rooms.'
  ].filter(Boolean).join('\n')));
}

async function handleCreateMatchChat(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const link = interaction.options.getString('link', true);
  const matchId = extractFaceitMatchIdFromLink(link);
  if (!matchId) {
    await interaction.editReply('I could not read a FACEIT match ID from that link. Use a FACEIT room link like `https://www.faceit.com/en/cs2/room/1-...`.');
    return;
  }

  const match = await findFaceitMatchForLink(link, matchId);
  if (!match) {
    await interaction.editReply('I could not find that match in the configured FACEIT Season 6 sources. Make sure `FACEIT_SOURCES` includes the Season 6 playoff championship.');
    return;
  }

  const guild = await client.guilds.fetch(config.discordGuildId);
  await guild.channels.fetch();
  await guild.roles.fetch();

  const matchForDiscord = clearDiscordScheduleStatus({
    ...match,
    faceitUrl: match.faceitUrl || normalizeSubmittedFaceitLink(link)
  });
  const discordIds = await provisionMatchChannel(guild, config, matchForDiscord);
  await saveMatch(matchForDiscord, discordIds);

  const channel = await guild.channels.fetch(discordIds.channelId);
  await upsertMatchIntroMessage(channel, matchForDiscord);

  const details = getMatchDisplayDetails(matchForDiscord);
  await interaction.editReply([
    `Created/updated match chat: <#${channel.id}>`,
    `Channel name: \`${channel.name}\``,
    details.stage ? `Stage: ${details.stage}` : null,
    details.round ? `Round: ${details.round}` : null,
    details.group ? `Group: ${details.group}` : null,
    `FACEIT match room: ${matchForDiscord.faceitUrl || 'not linked'}`
  ].filter(Boolean).join('\n'));
}

async function findFaceitMatchForLink(link, matchId) {
  const normalizedLink = normalizeSubmittedFaceitLink(link).toLowerCase();
  const normalizedMatchId = matchId.toLowerCase();
  const matches = (await faceit.getMatches()).map(normalizeSeason6PlayoffMatch);

  return matches.find((match) => {
    const faceitUrl = String(match.faceitUrl || '').toLowerCase();
    const id = String(match.id || '').toLowerCase();
    return id === normalizedMatchId ||
      id.endsWith(normalizedMatchId) ||
      normalizedMatchId.endsWith(id) ||
      (faceitUrl && faceitUrl === normalizedLink) ||
      (faceitUrl && faceitUrl.includes(normalizedMatchId));
  }) || null;
}

function extractFaceitMatchIdFromLink(value) {
  const text = String(value || '').trim();
  const roomMatch = text.match(/\/room\/([^/?#\s]+)/i);
  if (roomMatch) return decodeURIComponent(roomMatch[1]);

  const idMatch = text.match(/\b(?:1-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
  return idMatch ? idMatch[0] : '';
}

function normalizeSubmittedFaceitLink(value) {
  return String(value || '').trim().replace('%7Blang%7D', 'en').replace('{lang}', 'en');
}

async function savePendingScheduleToChannelTopic(channel, proposal) {
  const topic = stripPendingScheduleFromTopic(channel.topic);
  const pending = encodePendingSchedule(proposal);
  await channel.setTopic(
    [topic, `${PENDING_SCHEDULE_TOPIC_PREFIX}${pending}`]
      .filter(Boolean)
      .join(' | ')
      .slice(0, 1024)
  ).catch(() => null);
}

async function clearPendingScheduleFromChannelTopic(channel, proposalId) {
  const pending = getPendingScheduleFromChannelTopic(channel);
  if (proposalId && pending?.id && pending.id !== proposalId) return;

  const topic = stripPendingScheduleFromTopic(channel.topic);
  if (topic !== channel.topic) {
    await channel.setTopic(topic || null).catch(() => null);
  }
}

function getPendingScheduleFromChannelTopic(channel, matchId = null) {
  const topic = String(channel.topic || '');
  const escapedPrefix = PENDING_SCHEDULE_TOPIC_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = topic.match(new RegExp(`${escapedPrefix}\\s*([^|]+)`));
  if (!match) return null;

  const proposal = decodePendingSchedule(match[1].trim());
  if (!proposal) return null;
  if (matchId && proposal.matchId !== matchId) return null;
  return proposal;
}

function stripPendingScheduleFromTopic(topic) {
  const escapedPrefix = PENDING_SCHEDULE_TOPIC_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(topic || '')
    .replace(new RegExp(`\\s*\\|?\\s*${escapedPrefix}\\s*[^|]+`, 'g'), '')
    .replace(/\s+\|\s+$/g, '')
    .trim();
}

function encodePendingSchedule(proposal) {
  const pending = {
    id: proposal.id,
    matchId: proposal.matchId,
    scheduledAt: proposal.scheduledAt,
    scheduledAtIso: proposal.scheduledAtIso,
    timezone: proposal.timezone,
    proposedBy: proposal.proposedBy,
    proposerTeam: proposal.proposerTeam,
    kind: proposal.kind,
    override: proposal.override
  };

  return Buffer.from(JSON.stringify(pending), 'utf8').toString('base64url');
}

function decodePendingSchedule(value) {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

async function getRecoverableScheduleProposal(channel, stored) {
  return await getLatestOpenScheduleProposalForMatch(stored.match.id) ||
    getPendingScheduleFromChannelTopic(channel, stored.match.id) ||
    await getPendingScheduleFromRecentMessages(channel, stored);
}

async function getPendingScheduleFromRecentMessages(channel, stored) {
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) return null;

  const proposalMessage = [...messages.values()]
    .filter((message) => message.author?.id === client.user?.id)
    .find((message) => isScheduleProposalMessage(message, stored.match));
  if (!proposalMessage) return null;

  return buildProposalFromMessage(proposalMessage, stored);
}

function isScheduleProposalMessage(message, match) {
  const content = String(message.content || '');
  const plainTextProposal = /\*\*(?:Schedule|Reschedule) proposed:\*\*/i.test(content) &&
    content.includes(`${match.teamA} vs ${match.teamB}`) &&
    /Other team:\s*type `!accept` or `!decline`/i.test(content);
  const embedProposal = (message.embeds || []).some((embed) =>
    String(embed.title || '').toLowerCase().includes('proposed') &&
    String(embed.description || '').includes(`${match.teamA} vs ${match.teamB}`)
  );

  return plainTextProposal || embedProposal;
}

async function channelHasApprovedScheduleMessage(channel, match) {
  const messages = await channel.messages.fetch({ limit: 75 }).catch(() => null);
  if (!messages) return false;

  return messages.some((message) => isApprovedScheduleMessage(message, match));
}

function isApprovedScheduleMessage(message, match) {
  const matchTitle = `${match.teamA} vs ${match.teamB}`;
  const faceitUrl = String(match.faceitUrl || '');
  const content = String(message.content || '');
  const legacyPlainTextApproved = /admin approved schedule request/i.test(content);
  const plainTextApproved = /Schedule Approved By Admin/i.test(content) &&
    (content.includes(matchTitle) || (faceitUrl && content.includes(faceitUrl)));
  const embedApproved = (message.embeds || []).some((embed) => {
    const title = String(embed.title || '').toLowerCase();
    const description = String(embed.description || '');
    const fieldsText = (embed.fields || []).map((field) => String(field.value || '')).join('\n');
    return title.includes('schedule approved by admin') &&
      (description.includes(matchTitle) || (faceitUrl && fieldsText.includes(faceitUrl)));
  });

  return legacyPlainTextApproved || plainTextApproved || embedApproved;
}

function buildProposalFromMessage(message, stored) {
  const content = String(message.content || '');
  const embed = (message.embeds || []).find((candidate) =>
    String(candidate.title || '').toLowerCase().includes('proposed')
  );
  const timeField = embed?.fields?.find((field) => field.name === 'Time');
  const proposedByField = embed?.fields?.find((field) => field.name === 'Proposed By');
  const timeMatch = content.match(/^Time:\s*\*\*(.+?)\*\*/mi);
  const proposedByMatch = content.match(/Proposed by:\s*<@!?(\d{15,25})>/i) ||
    String(proposedByField?.value || '').match(/<@!?(\d{15,25})>/i);
  const roleMentionMatch = content.match(/^<@&(\d{15,25})>/m);
  const mentionedRoleId = roleMentionMatch?.[1] || '';
  const proposerTeam = mentionedRoleId === stored.discord.teamARoleId ? 'teamB' : 'teamA';
  const kind = /\*\*Reschedule proposed:\*\*/i.test(content) ||
    String(embed?.title || '').toLowerCase().includes('reschedule')
    ? 'reschedule'
    : 'schedule';
  const scheduledAt = (timeMatch?.[1] || timeField?.value || '')
    .replace(/\s*\(<t:\d+:[A-Za-z]>\)\s*$/, '')
    .trim() || 'unknown time';
  const parsedSchedule = parseScheduleInput(scheduledAt);

  return {
    id: `recovered:${message.id}`,
    matchId: stored.match.id,
    scheduledAt: parsedSchedule?.display || scheduledAt,
    scheduledAtIso: parsedSchedule?.iso || null,
    timezone: parsedSchedule?.timeZone || config.defaultTimezone,
    timezoneInput: parsedSchedule?.timeZoneInput || null,
    proposedBy: proposedByMatch?.[1] || message.author.id,
    proposerTeam,
    accepted: false,
    kind,
    source: 'recovered_message',
    validation: validateScheduleRequest(stored, scheduledAt, kind, parsedSchedule?.date || null),
    override: false
  };
}

function clearDiscordScheduleStatus(match) {
  const next = { ...match };
  delete next.scheduledByDiscord;
  if (next.status === 'discord_scheduled') {
    next.status = 'unknown';
  }
  return next;
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
      channel: null,
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
    channel,
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

function getRequestedRoundFilter(interaction) {
  const rawValue = interaction.options.get('round')?.value;
  const value = String(rawValue || 'all').toLowerCase();
  if (!value || value === 'all' || value === '0') return null;

  if (PLAYOFF_ROUND_FILTERS[value]) return PLAYOFF_ROUND_FILTERS[value];

  const legacyRoundNumber = Number(value);
  if ([1, 2, 3].includes(legacyRoundNumber)) {
    return {
      label: `Group Stage - Round ${legacyRoundNumber}`,
      legacyGroupStageRound: legacyRoundNumber
    };
  }

  return {
    label: String(rawValue),
    categories: [String(rawValue)]
  };
}

function normalizeSeason6PlayoffMatch(match) {
  if (!match || !isPlayoffMatch(match)) return match;
  return {
    ...match,
    round: canonicalPlayoffRoundName(match.round || match.categoryName),
    categoryName: canonicalPlayoffRoundName(match.categoryName || match.round),
    group: ''
  };
}

function filterAndSortMatchesForSync(matches, roundFilter) {
  return matches
    .filter((match) => {
      if (!roundFilter) return true;
      if (roundFilter.legacyGroupStageRound) {
        return getGroupStageRoundNumber(match) === roundFilter.legacyGroupStageRound;
      }
      return roundFilter.categories.some((category) =>
        normalizeRoundCategory(match.round) === normalizeRoundCategory(category) ||
        normalizeRoundCategory(match.categoryName) === normalizeRoundCategory(category)
      );
    })
    .sort(compareMatchesForChannelOrder);
}

function isPlayoffMatch(match) {
  return String(match.source?.name || '').toLowerCase().includes('playoff');
}

function compareMatchesForChannelOrder(a, b) {
  return getPlayoffRoundSortIndex(a) - getPlayoffRoundSortIndex(b) ||
    getGroupStageRoundNumber(a) - getGroupStageRoundNumber(b) ||
    getGroupSortIndex(a) - getGroupSortIndex(b) ||
    getBracketSortIndex(a) - getBracketSortIndex(b) ||
    String(a.teamA || '').localeCompare(String(b.teamA || ''), undefined, { sensitivity: 'base' }) ||
    String(a.teamB || '').localeCompare(String(b.teamB || ''), undefined, { sensitivity: 'base' });
}

function getBracketSortIndex(match) {
  const manualOrder = SEASON6_WB_ROUND_OF_32_PAIR_ORDER.get(matchPairKey(match.teamA, match.teamB));
  if (Number.isInteger(manualOrder)) return manualOrder;

  const bracketOrder = Number(match.bracketOrder ?? match.raw?.bracket_position ?? match.raw?.match_position);
  return Number.isFinite(bracketOrder) ? bracketOrder : 999;
}

function getPlayoffRoundSortIndex(match) {
  const round = normalizeRoundCategory(match.categoryName || match.round);
  const order = [
    ['upper bracket round 1', 'wb round of 32'],
    ['upper bracket round 2', 'wb round of 16'],
    ['lower bracket round 1', 'losers round 1'],
    ['upper bracket round 3', 'wb quarterfinals'],
    ['lower bracket round 2', 'losers round 2'],
    ['lower bracket round 3', 'losers round 3'],
    ['upper bracket round 4', 'wb semifinals'],
    ['lower bracket round 4', 'losers round 4'],
    ['lower bracket round 5', 'losers round 5'],
    ['upper bracket round 5', 'wb final'],
    ['lower bracket round 6', 'losers round 6'],
    ['lower bracket round 7', 'losers round 7'],
    ['lower bracket round 8', 'lower bracket final', 'losers final'],
    ['grand final', 'grand final bo5']
  ];
  const index = order.findIndex((aliases) => aliases.includes(round));
  return index >= 0 ? index : 999;
}

function normalizeRoundCategory(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\bquarter finals\b/g, 'quarterfinals')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function matchPairKey(teamA, teamB) {
  return [normalizeTeamKey(teamA), normalizeTeamKey(teamB)].sort().join('|');
}

function normalizeTeamKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function getGroupStageRoundNumber(match) {
  if (!isGroupStageMatch(match)) return 999;

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
    `Team test: give yourself one sample team role, give another person the other sample team role, then test \`!propose Tuesday 8 PM EDT\` and \`!accept\`.`,
    `Tournament Ops test: give yourself the Tournament Ops role, then test \`!schedule Tuesday 8 PM EDT\` without \`!accept\`.`
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

  await interaction.editReply(truncateDiscordMessage(
    `Synced team roles from Google Sheet. Created ${result.rolesCreated} role(s), added ${result.added} team role assignment(s), ${result.participantAdded} season participant assignment(s), ${result.captainAdded} captain role assignment(s), removed ${result.removed} stale role assignment(s), changed ${result.nicknamesChanged} nickname(s), sent ${result.captainDmsSent} captain DM(s). Skipped ${result.skipped}.${missingLine}${failedLine}`
  ));
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

  await interaction.editReply(truncateDiscordMessage(
    `Captain audit complete. Found ${result.found.length}/${result.totalTeams} captain(s). Missing ${result.missing.length}.\n${body}${moreLine}`
  ));
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

  await interaction.editReply(truncateDiscordMessage(
    `Missing player audit complete. Found ${result.foundPlayers}/${result.checkedPlayers} listed player(s). Missing ${result.missingPlayers} across ${result.teams.length} team(s).\n${body}${hiddenLine}`
  ));
}

async function handleTextScheduleProposal(message, content, kind) {
  const stored = await getStoredMatchForChannel(message.channel);
  if (!stored) {
    await message.reply(await buildUnlinkedMatchChannelMessage(message.channel, [
      kind === 'reschedule'
        ? 'Use `!reschedule` inside a match channel created by the bot.'
        : 'Use `!schedule` or `!propose` inside a match channel created by the bot.',
      'If this should be a match room, run `/cf audit target:matches fix:true` to repair missing links, names, and permissions.'
    ]));
    return;
  }

  const member = await message.guild.members.fetch(message.author.id);
  const proposerTeam = await getMemberTeamWithRecovery(member, message.channel, stored);
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
    await message.channel.send({
      embeds: [scheduleStatusEmbed({
        title: kind === 'reschedule' ? 'Reschedule Set By Tournament Ops' : 'Schedule Set By Tournament Ops',
        color: EMBED_COLORS.admin,
        stored,
        proposal,
        actorLabel: 'Set By',
        actorId: message.author.id,
        footer: faceitLine,
        warning: validation.warning
      })]
    });
    await notifyAdmins(message.guild, stored, proposal, message.author.id, faceitLine);
    return;
  }

  await savePendingScheduleToChannelTopic(message.channel, proposal);

  const otherTeam = proposerTeam === 'teamA' ? 'teamB' : 'teamA';
  const otherRoleId = otherTeam === 'teamA'
    ? stored.discord.teamARoleId
    : stored.discord.teamBRoleId;

  await message.channel.send({
    content: `<@&${otherRoleId}>`,
    embeds: [scheduleStatusEmbed({
      title: kind === 'reschedule' ? 'Reschedule Proposed' : 'Schedule Proposed',
      color: EMBED_COLORS.proposed,
      stored,
      proposal,
      actorLabel: 'Proposed By',
      actorId: message.author.id,
      footer: 'Other team: type !accept or !decline to confirm.',
      warning: validation.warning
    })],
    allowedMentions: {
      roles: [otherRoleId],
      users: [],
      repliedUser: false
    }
  });
}

async function handleTextAccept(message) {
  const stored = await getStoredMatchForChannel(message.channel);
  if (!stored) {
    await message.reply(await buildUnlinkedMatchChannelMessage(message.channel, [
      'Use `!accept` inside a match channel created by the bot.',
      'If this is a match room, run `/cf audit target:matches fix:true` so I can relink it.'
    ]));
    return;
  }

  const proposal = await getRecoverableScheduleProposal(message.channel, stored);
  if (!proposal) {
    await message.reply('There is no open schedule proposal for this match.');
    return;
  }

  const member = await message.guild.members.fetch(message.author.id);
  const memberTeam = await getMemberTeamWithRecovery(member, message.channel, stored);
  const otherTeam = proposal.proposerTeam === 'teamA' ? 'teamB' : 'teamA';
  if (memberTeam !== otherTeam) {
    await message.reply('Only a member from the other team can accept this schedule.');
    return;
  }

  const faceitLine = await applyAcceptedSchedule(message.channel, stored, proposal, message.author.id);
  await clearPendingScheduleFromChannelTopic(message.channel, proposal.id);

  await message.channel.send({
    embeds: [scheduleStatusEmbed({
      title: proposal.kind === 'reschedule' ? 'Reschedule Accepted' : 'Schedule Accepted',
      color: EMBED_COLORS.accepted,
      stored,
      proposal,
      actorLabel: 'Accepted By',
      actorId: message.author.id,
      footer: faceitLine
    })]
  });

  await notifyAdmins(message.guild, stored, proposal, message.author.id, faceitLine);
}

async function handleTextDecline(message) {
  const stored = await getStoredMatchForChannel(message.channel);
  if (!stored) {
    await message.reply(await buildUnlinkedMatchChannelMessage(message.channel, [
      'Use `!decline` inside a match channel created by the bot.',
      'If this is a match room, run `/cf audit target:matches fix:true` so I can relink it.'
    ]));
    return;
  }

  const proposal = await getRecoverableScheduleProposal(message.channel, stored);
  if (!proposal) {
    await message.reply('There is no open schedule proposal for this match.');
    return;
  }

  const member = await message.guild.members.fetch(message.author.id);
  const memberTeam = await getMemberTeamWithRecovery(member, message.channel, stored);
  const otherTeam = proposal.proposerTeam === 'teamA' ? 'teamB' : 'teamA';
  if (memberTeam !== otherTeam) {
    await message.reply('Only a member from the other team can decline this schedule.');
    return;
  }

  await declineScheduleProposal(proposal.id, message.author.id);
  await clearPendingScheduleFromChannelTopic(message.channel, proposal.id);
  await message.channel.send({
    content: `<@${proposal.proposedBy}>`,
    embeds: [scheduleStatusEmbed({
      title: 'Schedule Declined',
      color: EMBED_COLORS.declined,
      stored,
      proposal,
      timeLabel: 'Declined Time',
      actorLabel: 'Declined By',
      actorId: message.author.id,
      footer: 'A team member can propose another time with !schedule tomorrow at 9 PM EST.'
    })],
    allowedMentions: {
      users: [proposal.proposedBy],
      roles: [],
      repliedUser: false
    }
  });
}

async function handleCallAdmin(message, content) {
  const stored = await getStoredMatchForChannel(message.channel);
  if (!stored) {
    await message.reply(await buildUnlinkedMatchChannelMessage(message.channel, [
      'Use `!admin` or `!calladmin` inside a match channel created by the bot.',
      'If this is a match room, run `/cf audit target:matches fix:true` so I can relink it.'
    ]));
    return;
  }

  const reason = content.replace(/^!(?:calladmin|admin)\s*/i, '').trim() || 'No reason given';
  const adminChannel = await getCallAdminChannel();
  const staffMentions = getStaffMentions(message.guild);
  const allowedMentions = getAdminAllowedMentions(message.guild);
  const matchDetails = getMatchDisplayDetails(stored.match);

  const alertEmbed = new EmbedBuilder()
    .setColor(EMBED_COLORS.warning)
    .setTitle('Admin Help Requested')
    .setDescription(`**${stored.match.teamA} vs ${stored.match.teamB}**`)
    .addFields([
      matchDetails.stage ? { name: 'Stage', value: matchDetails.stage, inline: true } : null,
      { name: 'Round', value: matchDetails.round || 'Unknown', inline: true },
      matchDetails.group ? { name: 'Group', value: matchDetails.group, inline: true } : null,
      { name: 'Discord Channel', value: `<#${message.channel.id}>`, inline: false },
      { name: 'Requested By', value: `<@${message.author.id}>`, inline: true },
      { name: 'Reason', value: reason.slice(0, 1024), inline: false },
      stored.match.faceitUrl ? { name: 'FACEIT Match Room', value: stored.match.faceitUrl, inline: false } : null
    ].filter(Boolean))
    .setFooter({ text: 'Press Claim this ticket to tell the match room you are handling it.' })
    .setTimestamp(new Date());

  if (adminChannel) {
    await adminChannel.send({
      content: staffMentions,
      embeds: [alertEmbed],
      allowedMentions,
      components: [callAdminClaimButton(message.channel.id)]
    });
    await message.reply('Admins have been notified.');
    return;
  }

  await message.channel.send({
    content: staffMentions,
    embeds: [alertEmbed],
    allowedMentions,
    components: [callAdminClaimButton(message.channel.id)]
  });
}

function scheduleStatusEmbed({
  title,
  color,
  stored,
  proposal,
  timeLabel = 'Time',
  actorLabel,
  actorId,
  footer,
  warning
}) {
  const matchDetails = getMatchDisplayDetails(stored.match);
  const fields = [
    {
      name: timeLabel,
      value: formatProposalTime(proposal),
      inline: false
    },
    matchDetails.stage ? {
      name: 'Stage',
      value: matchDetails.stage,
      inline: true
    } : null,
    matchDetails.round ? {
      name: 'Round',
      value: matchDetails.round,
      inline: true
    } : null,
    matchDetails.group ? {
      name: 'Group',
      value: matchDetails.group,
      inline: true
    } : null,
    actorId ? {
      name: actorLabel,
      value: `<@${actorId}>`,
      inline: true
    } : null,
    stored.discord?.channelId ? {
      name: 'Discord Match Chat',
      value: `<#${stored.discord.channelId}>`,
      inline: true
    } : null,
    stored.match.faceitUrl ? {
      name: 'FACEIT Match Room',
      value: stored.match.faceitUrl,
      inline: false
    } : null,
    warning ? {
      name: 'Warning',
      value: warning,
      inline: false
    } : null
  ].filter(Boolean);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(`**${stored.match.teamA} vs ${stored.match.teamB}**`)
    .addFields(fields)
    .setTimestamp(new Date());

  if (footer) {
    embed.setFooter({ text: String(footer).slice(0, 2048) });
  }

  return embed;
}

async function getStoredMatchForChannel(channel) {
  const stored = await getStoredMatchByChannel(channel.id);
  if (stored) return stored;

  return recoverStoredMatchFromChannel(channel);
}

async function buildUnlinkedMatchChannelMessage(channel, baseLines) {
  const matches = (await faceit.getMatches().catch(() => [])).map(normalizeSeason6PlayoffMatch);
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
    'Admin fix: run `/cf audit target:matches`, then `/cf audit target:matches fix:true` if it reports missing links or permissions.'
  ].join('\n');
}

async function recoverStoredMatchFromChannel(channel) {
  if (!channel.guild) return null;

  const matches = (await faceit.getMatches().catch(() => [])).map(normalizeSeason6PlayoffMatch);
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
    content: 'Scheduling is command-only now. In the match room, use `!schedule September 14 8 PM EDT`; teams confirm with `!accept`, and Tournament Ops can schedule directly.',
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

async function applyAcceptedSchedule(channel, stored, proposal, acceptedBy, options = {}) {
  const acceptedProposal = await acceptScheduleProposal(proposal.id, acceptedBy);
  if (!acceptedProposal) {
    await saveSchedule(proposal.matchId, {
      scheduledAt: proposal.scheduledAt,
      timezone: proposal.timezone,
      proposedBy: proposal.proposedBy,
      acceptedBy,
      proposalId: proposal.id,
      kind: proposal.kind || 'schedule'
    });
  }
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
    status: options.markScheduled ? 'discord_scheduled' : 'schedule_pending_admin',
    scheduledByDiscord: Boolean(options.markScheduled),
    scheduledAt: proposal.scheduledAt
  };
  if (options.markScheduled) {
    await updateMatchChannelName(channel, scheduledMatch);
  }
  await saveMatch(scheduledMatch, stored.discord);
  return faceitLine;
}

async function notifyAdmins(guild, stored, proposal, acceptedBy, faceitLine) {
  const channel = await getScheduleAdminChannel();
  const allowedMentions = getAdminAllowedMentions(guild);
  const adminEmbed = scheduleStatusEmbed({
    title: proposal.kind === 'reschedule'
      ? 'Action Needed: Approve Reschedule'
      : 'Action Needed: Schedule On FACEIT',
    color: EMBED_COLORS.warning,
    stored,
    proposal,
    timeLabel: 'Accepted Time',
    actorLabel: proposal.override ? 'Set By Tournament Ops' : 'Accepted By',
    actorId: acceptedBy,
    footer: faceitLine,
    warning: [
      proposal.validation?.warning,
      proposal.validation?.roundWindowMessage,
      proposal.kind === 'reschedule' ? `Current/previous schedule: ${currentScheduleText(stored)}` : null
    ].filter(Boolean).join('\n') || null
  }).addFields({
    name: 'Proposed By',
    value: `<@${proposal.proposedBy}>`,
    inline: true
  });
  const targetChannel = channel || await guild.channels.fetch(stored.discord.channelId).catch(() => null);

  if (!targetChannel) return;

  await targetChannel.send({
    content: getStaffMentions(guild),
    embeds: [adminEmbed],
    allowedMentions,
    components: [adminDecisionButtons(proposal.id, stored.discord.channelId)]
  });
}

async function upsertMatchIntroMessage(channel, match) {
  const stored = await getStoredMatch(match.id);
  const discordIds = stored?.discord || {};
  const content = buildMatchIntroMessage(channel, match, discordIds);
  const allowedMentions = getIntroAllowedMentions(discordIds);
  const existingMessage = stored?.discord?.introMessageId
    ? await channel.messages.fetch(stored.discord.introMessageId).catch(() => null)
    : await findExistingIntroMessage(channel, match);

  if (existingMessage) {
    await existingMessage.edit({
      content,
      allowedMentions,
      components: []
    });
    await saveMatchIntroMessageId(match.id, existingMessage.id);
    return;
  }

  const message = await channel.send({
    content,
    allowedMentions
  });
  await saveMatchIntroMessageId(match.id, message.id);
  await message.pin().catch(() => null);
}

async function findExistingIntroMessage(channel, match) {
  const faceitUrl = String(match.faceitUrl || '').toLowerCase();
  const matchTitle = `${match.teamA} vs ${match.teamB}`.toLowerCase();

  const pinned = await channel.messages.fetchPinned().catch(() => null);
  const pinnedMatch = pinned?.find((message) => isIntroMessage(message, faceitUrl, matchTitle));
  if (pinnedMatch) return pinnedMatch;

  const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  return recent?.find((message) => isIntroMessage(message, faceitUrl, matchTitle)) || null;
}

function isIntroMessage(message, faceitUrl, matchTitle) {
  if (message.author?.id !== client.user?.id) return false;

  const content = String(message.content || '').toLowerCase();
  return (
    content.includes('how to schedule this match') &&
    content.includes(matchTitle) &&
    (!faceitUrl || content.includes(faceitUrl))
  );
}

function buildMatchIntroMessage(channel, match, discordIds = {}) {
  const displayMatch = normalizeMatchForDisplay(match);
  const roundInfo = getSeasonRoundInfo(displayMatch);
  const scheduleWindow = getScheduleWindowForMatch(displayMatch);
  const matchDetails = getMatchDisplayDetails(displayMatch);
  const teamMentions = [
    discordIds.teamARoleId ? `<@&${discordIds.teamARoleId}>` : `**${displayMatch.teamA}**`,
    discordIds.teamBRoleId ? `<@&${discordIds.teamBRoleId}>` : `**${displayMatch.teamB}**`
  ].join(' vs ');
  const ticketChannel = config.rosterTicketChannelId
    ? `<#${config.rosterTicketChannelId}>`
    : getChannelMentionByName(channel.guild, 'make-a-ticket') || '#make-a-ticket';
  const adminNotificationLine = getAdminNotificationLine(channel);

  return [
    teamMentions,
    '',
    `**${displayMatch.teamA} vs ${displayMatch.teamB}**`,
    '',
    matchDetails.stage ? `Stage: **${matchDetails.stage}**` : null,
    `Round: **${matchDetails.round}**`,
    matchDetails.group ? `Group: **${matchDetails.group}**` : null,
    scheduleWindow ? `${scheduleWindow.label}: **${formatScheduleWindow(scheduleWindow)}**` : 'Scheduling window: **not configured yet**',
    roundInfo ? `Default match date/time: **${formatDefaultMatchDateTime(roundInfo)}**` : 'Default match date/time: **admins will announce**',
    `Discord match chat: <#${channel.id}>`,
    faceitRoomLine(displayMatch),
    getFaceitScheduledTimeLine(displayMatch),
    '',
    '**How to schedule this match**',
    '1. One team member posts `!schedule 9/14/2026 8 PM EDT`, `!schedule Tuesday 3 PM EDT`, or `!schedule September 14 8:00 PM EDT`.',
    '2. The bot detects the timezone, records the proposed time, and pings the other team role.',
    '3. A member from the other team posts `!accept` to confirm or `!decline` to reject.',
    `4. After \`!accept\`, ${adminNotificationLine}`,
    'Tournament Ops can use `!schedule September 14 8 PM EDT` to set the time directly without team approval.',
    '',
    '**Other commands**',
    '`!propose September 14 8:00 PM EDT` - same as `!schedule`',
    '`!reschedule September 14 9:00 PM EDT` - team member requests a new time',
    'Schedules and reschedules must stay inside this match window. Reschedules within 24 hours of match time require admin override.',
    isGroupStageMatch(displayMatch)
      ? 'Group Stage note: any Group Stage match can be scheduled by mutual agreement from August 31, 2026 through September 8, 2026.'
      : 'Playoff note: teams may agree to schedule their match any time during the assigned three-day window.',
    `Roster changes: go to ${ticketChannel}.`,
    '',
    '**Admin Help**',
    '`!admin reason here` or `!calladmin reason here` - alerts admins with this match channel and FACEIT link'
  ].filter((line) => line !== null).join('\n');
}

function getAdminNotificationLine(channel) {
  return 'admins are notified and pinged to schedule it on FACEIT.';
}

function formatScheduleWindow(window) {
  if (window.displayWindow) return window.displayWindow;
  return `${window.start} - ${window.end}`;
}

function formatDefaultMatchDateTime(roundInfo) {
  return roundInfo.defaultDateTime || `${roundInfo.defaultDate} at 8:00 PM EDT`;
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

  const text = normalizeRoundCategory(`${stageName} ${roundName}`);
  if (text.includes('grand final')) return seasonWindow('Grand Final (BO5)');
  if (text.includes('lower bracket round 8') || text.includes('lower bracket final') || text.includes('losers final') || text.includes('lower final')) return seasonWindow('Lower Bracket - Round 8');
  if (text.includes('lower bracket round 7') || text.includes('losers round 7') || text.includes('lower round 7')) return seasonWindow('Lower Bracket - Round 7');
  if (text.includes('upper bracket round 5') || (text.includes('winner') && text.includes('final')) || text.includes('wb final') || text.includes('upper final')) return seasonWindow('Upper Bracket - Round 5');
  if (text.includes('lower bracket round 6') || text.includes('losers round 6') || text.includes('lower round 6')) return seasonWindow('Lower Bracket - Round 6');
  if (text.includes('lower bracket round 5') || text.includes('losers round 5') || text.includes('lower round 5')) return seasonWindow('Lower Bracket - Round 5');
  if (text.includes('lower bracket round 4') || text.includes('losers round 4') || text.includes('lower round 4')) return seasonWindow('Lower Bracket - Round 4');
  if (text.includes('upper bracket round 4') || text.includes('semi')) return seasonWindow('Upper Bracket - Round 4');
  if (text.includes('lower bracket round 3') || text.includes('losers round 3') || text.includes('lower round 3')) return seasonWindow('Lower Bracket - Round 3');
  if (text.includes('lower bracket round 2') || text.includes('losers round 2') || text.includes('lower round 2')) return seasonWindow('Lower Bracket - Round 2');
  if (text.includes('upper bracket round 3') || text.includes('quarter')) return seasonWindow('Upper Bracket - Round 3');
  if (text.includes('upper bracket round 2') || text.includes('round of 16')) return seasonWindow('Upper Bracket - Round 2');
  if (text.includes('lower bracket round 1') || text.includes('losers round 1') || text.includes('lower round 1')) return seasonWindow('Lower Bracket - Round 1');
  if (text.includes('upper bracket round 1') || text.includes('round of 32')) return seasonWindow('Upper Bracket - Round 1');

  if (stageName.includes('playoff') || text.includes('playoff')) return seasonWindow('Playoff Stage');
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

  const [, proposalId, channelId] = interaction.customId.split(':');
  const proposal = approved
    ? await approveScheduleProposal(proposalId, interaction.user.id)
    : await denyScheduleProposal(proposalId, interaction.user.id);
  const stored = proposal
    ? await getStoredMatch(proposal.matchId)
    : await findStoredMatchFromAdminMessage(interaction.message, channelId);

  const matchChannel = stored
    ? await client.channels.fetch(stored.discord.channelId).catch(() => null)
    : null;

  if (matchChannel) {
    await matchChannel.send({
      embeds: [adminDecisionEmbed({
        approved,
        stored,
        proposal,
        adminId: interaction.user.id
      })]
    });
  }

  if (approved) {
    let renameResult = null;
    if (matchChannel && stored) {
      renameResult = await markMatchChannelScheduled(matchChannel, stored, proposal);
    }
    await interaction.message.react('✅').catch(() => null);
    const missingProposalNote = proposal ? '' : ' I could not find the saved schedule request, so I used the admin message/match channel fallback.';
    const missingChannelNote = matchChannel ? '' : ' I could not find the match channel to mark yellow.';
    const renameFailureNote = renameResult?.error
      ? ` Discord blocked the channel rename: ${renameResult.error.message}`
      : '';
    await interaction.editReply(`Approved and reacted with a checkmark.${missingProposalNote}${missingChannelNote}${renameFailureNote}`);
  } else {
    await interaction.message.react('❌').catch(() => null);
    const missingProposalNote = proposal ? '' : ' I could not find the saved schedule request, so I used the admin message/match channel fallback.';
    const missingChannelNote = matchChannel ? '' : ' I could not find the match channel.';
    await interaction.editReply(`Denied and reacted with an X.${missingProposalNote}${missingChannelNote}`);
  }
}

function normalizeMatchForDisplay(match) {
  if (!match || !isPlayoffMatch(match)) return match;

  const round = canonicalPlayoffRoundName(match.round || match.categoryName);
  const categoryName = canonicalPlayoffRoundName(match.categoryName || match.round);
  return {
    ...match,
    round,
    categoryName
  };
}

function canonicalPlayoffRoundName(value) {
  const normalized = normalizeRoundCategory(value);
  const names = new Map([
    ['wb round of 32', 'Upper Bracket - Round 1'],
    ['winner bracket round 1', 'Upper Bracket - Round 1'],
    ['winners bracket round 1', 'Upper Bracket - Round 1'],
    ['upper bracket round 1', 'Upper Bracket - Round 1'],
    ['wb round of 16', 'Upper Bracket - Round 2'],
    ['winner bracket round 2', 'Upper Bracket - Round 2'],
    ['winners bracket round 2', 'Upper Bracket - Round 2'],
    ['upper bracket round 2', 'Upper Bracket - Round 2'],
    ['wb quarterfinals', 'Upper Bracket - Round 3'],
    ['wb quarter finals', 'Upper Bracket - Round 3'],
    ['upper bracket round 3', 'Upper Bracket - Round 3'],
    ['wb semifinals', 'Upper Bracket - Round 4'],
    ['wb semi finals', 'Upper Bracket - Round 4'],
    ['upper bracket round 4', 'Upper Bracket - Round 4'],
    ['wb final', 'Upper Bracket - Round 5'],
    ['upper bracket final', 'Upper Bracket - Round 5'],
    ['upper bracket round 5', 'Upper Bracket - Round 5'],
    ['losers round 1', 'Lower Bracket - Round 1'],
    ['lower round 1', 'Lower Bracket - Round 1'],
    ['lower bracket round 1', 'Lower Bracket - Round 1'],
    ['losers round 2', 'Lower Bracket - Round 2'],
    ['lower round 2', 'Lower Bracket - Round 2'],
    ['lower bracket round 2', 'Lower Bracket - Round 2'],
    ['losers round 3', 'Lower Bracket - Round 3'],
    ['lower round 3', 'Lower Bracket - Round 3'],
    ['lower bracket round 3', 'Lower Bracket - Round 3'],
    ['losers round 4', 'Lower Bracket - Round 4'],
    ['lower round 4', 'Lower Bracket - Round 4'],
    ['lower bracket round 4', 'Lower Bracket - Round 4'],
    ['losers round 5', 'Lower Bracket - Round 5'],
    ['lower round 5', 'Lower Bracket - Round 5'],
    ['lower bracket round 5', 'Lower Bracket - Round 5'],
    ['losers round 6', 'Lower Bracket - Round 6'],
    ['lower round 6', 'Lower Bracket - Round 6'],
    ['lower bracket round 6', 'Lower Bracket - Round 6'],
    ['losers round 7', 'Lower Bracket - Round 7'],
    ['lower round 7', 'Lower Bracket - Round 7'],
    ['lower bracket round 7', 'Lower Bracket - Round 7'],
    ['losers final', 'Lower Bracket - Round 8'],
    ['lower final', 'Lower Bracket - Round 8'],
    ['lower bracket final', 'Lower Bracket - Round 8'],
    ['lower bracket round 8', 'Lower Bracket - Round 8'],
    ['grand final', 'Grand Final (BO5)'],
    ['grand final bo5', 'Grand Final (BO5)']
  ]);

  return names.get(normalized) || String(value || 'Playoff Stage');
}

async function findStoredMatchFromAdminMessage(message, channelId) {
  if (channelId) {
    const storedByChannel = await getStoredMatchByChannel(channelId);
    if (storedByChannel) return storedByChannel;
  }

  const content = String(message?.content || '');
  const channelMention = content.match(/<#(\d{15,25})>/);
  if (channelMention) {
    const storedByMention = await getStoredMatchByChannel(channelMention[1]);
    if (storedByMention) return storedByMention;
  }

  const storedMatches = await listStoredMatches();
  return storedMatches.find((stored) => {
    const faceitUrl = stored.match?.faceitUrl;
    return faceitUrl && content.includes(faceitUrl);
  }) || null;
}

async function markMatchChannelScheduled(channel, stored, proposal = null) {
  const scheduledMatch = {
    ...stored.match,
    status: 'discord_scheduled',
    scheduledByDiscord: true,
    scheduledAt: proposal?.scheduledAt || stored.match.scheduledAt || null
  };
  const renameResult = await updateMatchChannelName(channel, scheduledMatch);
  await saveMatch(scheduledMatch, stored.discord);
  return renameResult;
}

function buildApprovedScheduleSheetRow({ stored, proposal, approvedBy, acceptedBy, channel }) {
  const match = stored.match;
  const details = getMatchDisplayDetails(match);
  const discordChannelId = channel?.id || stored.discord?.channelId || '';
  return {
    approvedAt: new Date().toISOString(),
    matchName: `${match.teamA} vs ${match.teamB}`,
    teamA: match.teamA || '',
    teamB: match.teamB || '',
    teamAScore: match.teamAScore,
    teamBScore: match.teamBScore,
    stage: details.stage || '',
    round: details.round || '',
    group: details.group || '',
    scheduledAt: proposal?.scheduledAt || match.scheduledAt || '',
    scheduledAtIso: proposal?.scheduledAtIso || '',
    timezone: proposal?.timezone || config.defaultTimezone,
    faceitUrl: match.faceitUrl || '',
    discordChannelId,
    discordChannelUrl: discordChannelId ? `https://discord.com/channels/${stored.discord?.guildId || config.discordGuildId}/${discordChannelId}` : '',
    proposedBy: proposal?.proposedBy || '',
    acceptedBy: acceptedBy || proposal?.acceptedBy || '',
    approvedBy,
    kind: proposal?.kind || 'schedule'
  };
}

function adminDecisionEmbed({ approved, stored, proposal, adminId }) {
  const embed = new EmbedBuilder()
    .setColor(approved ? EMBED_COLORS.accepted : EMBED_COLORS.declined)
    .setTitle(approved ? 'Schedule Approved By Admin' : 'Schedule Denied By Admin')
    .setDescription(`**${stored.match.teamA} vs ${stored.match.teamB}**`)
    .addFields([
      proposal ? {
        name: 'Time',
        value: formatProposalTime(proposal),
        inline: false
      } : null,
      {
        name: 'Admin',
        value: `<@${adminId}>`,
        inline: true
      },
      stored.match.faceitUrl ? {
        name: 'FACEIT Match Room',
        value: stored.match.faceitUrl,
        inline: false
      } : null
    ].filter(Boolean))
    .setTimestamp(new Date());

  if (approved) {
    embed.setFooter({ text: 'The match channel is now marked scheduled.' });
  }

  return embed;
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
    const start = parseScheduleText(`${window.start} 12:00 AM ET`);
    const end = parseScheduleText(`${window.end} 11:59 PM ET`);
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
  const configuredWindow = config.roundWindows[String(match.round || '').toLowerCase()] ||
    config.roundWindows[String(canonicalPlayoffRoundName(match.round || match.categoryName)).toLowerCase()];
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

function adminDecisionButtons(proposalId, channelId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(['admin_schedule_approve', proposalId, channelId].filter(Boolean).join(':'))
      .setLabel('Admin approve')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(['admin_schedule_deny', proposalId, channelId].filter(Boolean).join(':'))
      .setLabel('Admin deny')
      .setStyle(ButtonStyle.Danger)
  );
}

function callAdminClaimButton(channelId, claimed = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`calladmin_claim:${channelId}`)
      .setLabel(claimed ? 'Ticket claimed' : 'Claim this ticket')
      .setStyle(claimed ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(claimed)
  );
}

function getMemberTeam(member, discordIds) {
  if (discordIds?.teamARoleId && member.roles.cache.has(discordIds.teamARoleId)) return 'teamA';
  if (discordIds?.teamBRoleId && member.roles.cache.has(discordIds.teamBRoleId)) return 'teamB';
  return null;
}

function hasScheduledChannelPrefix(channelName) {
  return String(channelName || '').startsWith('🟡-');
}

function hasFinishedChannelPrefix(channelName) {
  return String(channelName || '').startsWith('🟢-');
}

function refreshStatusWithStoredState(faceitStatus, storedStatus, wasMarkedFinished) {
  const normalizedFaceitStatus = String(faceitStatus || '').toLowerCase();
  if (isFinishedStatus(normalizedFaceitStatus)) return faceitStatus;
  if (wasMarkedFinished || storedStatus === 'scl_demo_ready') return 'scl_demo_ready';
  if (normalizedFaceitStatus === 'unknown' && storedStatus === 'discord_scheduled') return 'discord_scheduled';
  return faceitStatus;
}

function isFinishedStatus(status) {
  return ['finished', 'done', 'completed', 'cancelled', 'scl_demo_ready'].some((value) =>
    String(status || '').toLowerCase().includes(value)
  );
}

async function getMemberTeamWithRecovery(member, channel, stored) {
  const existingTeam = getMemberTeam(member, stored.discord);
  if (existingTeam) return existingTeam;

  await member.guild.roles.fetch().catch(() => null);

  const resolvedTeamARole = await resolveTeamRole(member.guild, config, stored.match.teamA).catch(() => null);
  const resolvedTeamBRole = await resolveTeamRole(member.guild, config, stored.match.teamB).catch(() => null);
  if (resolvedTeamARole && resolvedTeamBRole && resolvedTeamARole.id !== resolvedTeamBRole.id) {
    const resolvedIds = {
      ...stored.discord,
      teamARoleId: resolvedTeamARole.id,
      teamBRoleId: resolvedTeamBRole.id
    };
    const resolvedTeam = getMemberTeam(member, resolvedIds);
    if (resolvedTeam) {
      stored.discord = resolvedIds;
      await saveMatch(stored.match, resolvedIds);
      console.warn(`[team roles] repaired mapping by team name match_id=${stored.match.id} team_a_role=${resolvedIds.teamARoleId} team_b_role=${resolvedIds.teamBRoleId}`);
      return resolvedTeam;
    }
  }

  const candidates = getMatchChannelTeamRoleCandidates(channel, member.guild);
  if (candidates.length !== 2) {
    console.warn(`[team roles] could not recover unique channel roles match_id=${stored.match.id} channel_id=${channel.id} candidates=${candidates.length}`);
    return null;
  }

  let teamARole = findCandidateRoleForTeam(candidates, stored.match.teamA);
  let teamBRole = findCandidateRoleForTeam(candidates, stored.match.teamB);
  if (teamARole?.id === teamBRole?.id) {
    teamARole = null;
    teamBRole = null;
  }

  if (!teamARole || !teamBRole) {
    const priorA = candidates.find((role) => role.id === stored.discord?.teamARoleId);
    const priorB = candidates.find((role) => role.id === stored.discord?.teamBRoleId);
    if (priorA && priorB && priorA.id !== priorB.id) {
      teamARole = priorA;
      teamBRole = priorB;
    }
  }

  if (!teamARole || !teamBRole) {
    const memberCandidate = candidates.find((role) => member.roles.cache.has(role.id));
    if (!memberCandidate) return null;
    teamARole = memberCandidate;
    teamBRole = candidates.find((role) => role.id !== memberCandidate.id);
  }

  const recoveredIds = {
    ...stored.discord,
    teamARoleId: teamARole.id,
    teamBRoleId: teamBRole.id
  };
  stored.discord = recoveredIds;
  await saveMatch(stored.match, recoveredIds);
  console.warn(`[team roles] repaired mapping from channel permissions match_id=${stored.match.id} channel_id=${channel.id} team_a_role=${teamARole.id} team_b_role=${teamBRole.id}`);
  return getMemberTeam(member, recoveredIds);
}

function getMatchChannelTeamRoleCandidates(channel, guild) {
  const excludedIds = new Set([
    guild.roles.everyone.id,
    config.discordStaffRoleId,
    ...config.matchAccessRoleIds,
    ...config.scheduleOverrideRoleIds
  ].filter(Boolean));

  return [...(channel.permissionOverwrites?.cache?.values?.() || [])]
    .filter((overwrite) => !excludedIds.has(overwrite.id))
    .filter((overwrite) => overwrite.allow?.has?.(PermissionFlagsBits.ViewChannel))
    .map((overwrite) => guild.roles.cache.get(overwrite.id))
    .filter((role) => role && !role.managed)
    .filter((role) =>
      !role.permissions.has(PermissionFlagsBits.Administrator) &&
      !role.permissions.has(PermissionFlagsBits.ManageGuild)
    );
}

function findCandidateRoleForTeam(candidates, teamName) {
  const normalizedTeam = normalizeSclTeamName(teamName);
  if (!normalizedTeam) return null;

  const exact = candidates.find((role) => normalizeSclTeamName(role.name) === normalizedTeam);
  if (exact) return exact;

  return candidates.find((role) => {
    const normalizedRole = normalizeSclTeamName(role.name);
    const shorterLength = Math.min(normalizedRole.length, normalizedTeam.length);
    return shorterLength >= 5 && (
      normalizedRole.includes(normalizedTeam) || normalizedTeam.includes(normalizedRole)
    );
  }) || null;
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
