import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  Partials,
  PermissionFlagsBits,
  REST,
  Routes,
  TextInputBuilder,
  TextInputStyle
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
  appendAuditLog,
  approveScheduleProposal,
  claimPostCastReminder,
  claimStreamApproval,
  claimStreamDeliveryPrompt,
  claimStreamRepublish,
  createStreamRequestUnlessActive,
  listStreamRequestsAwaitingStaffPost,
  recordStreamPublishResult,
  relinkMatchChannel,
  recoverInterruptedStreamPublishes,
  denyScheduleProposal,
  declineScheduleProposal,
  getLatestOpenScheduleProposalForMatch,
  getSchedule,
  getScheduleProposal,
  getStreamRequest,
  getSclDiscordMessage,
  getStoredMatch,
  getStoredMatchByChannel,
  listStoredMatches,
  listAdminTickets,
  listAuditLog,
  listScheduleProposals,
  listSchedules,
  listStreamRequests,
  listTeamMappings,
  listVetoes,
  getVeto,
  saveAdminTicket,
  saveMatch,
  saveMatchIntroMessageId,
  savePostedSclDemo,
  saveSclDiscordMessage,
  saveSchedule,
  saveScheduleProposal,
  saveTeamMapping,
  saveVeto,
  updateStreamRequest
} from './store.js';
import { scheduleFaceitMatch } from './faceitSchedule.js';
import { auditMissingCaptains, auditMissingPlayers, getTeamMappingScope, syncRolesFromSheet } from './sheetRoles.js';
import { startWebhookServer } from './webhookServer.js';
import { applyVetoAction, chooseFirstAction, createVeto, expectedVetoAction } from './vetoEngine.js';
import {
  STREAM_ACTIVE_STATUSES,
  STREAM_STAFF_ACTION_STATUSES,
  STREAM_STATUS_LABELS,
  classifyFaceitScheduleChange,
  formatEasternDateTimeInput,
  formatScheduleForDiscord,
  isCanceledFaceitStatus,
  isTerminalFaceitStatus,
  classifyCasterExit,
  findOutstandingPostCast,
  makeStreamRequestId,
  makeStreamRequestModalId,
  normalizeWithdrawalReason,
  postCastFormLink,
  parseFaceitMatchRoomLink,
  parseStreamRequestModalId,
  validateDenialReason,
  validateStreamDelivery,
  validateStreamRequest,
  STREAM_WITHDRAWABLE_STATUSES
} from './streamRequest.js';
import { parseScheduleClock } from './scheduleInput.js';
import { createWebsitePublisher } from './websitePublisher.js';
import { buildScheduleSheetRow, buildStreamLinkSheetRow, createScheduleSheet } from './scheduleSheet.js';
import { isAuthorizedStaffMember, parseForceDirective } from './operationsPolicy.js';

const config = getConfig();
const websitePublisher = createWebsitePublisher(config);
const scheduleSheet = createScheduleSheet(config);
const lockPath = path.resolve('bot.lock');
claimSingleInstance(lockPath);

const faceit = new FaceitClient(
  config.faceitApiKey,
  config.faceitSources
);
const scl = new SclClient(config.sclApiKey);
const sclMessageUpdateQueues = new Map();
let webhookServer = null;
let operationsTimer = null;

const PENDING_SCHEDULE_TOPIC_PREFIX = 'Pending schedule:';
const EMBED_COLORS = {
  proposed: 0xf1c40f,
  accepted: 0x2ecc71,
  declined: 0xe74c3c,
  admin: 0x3498db,
  warning: 0xe67e22
};

const SEASON6_GROUP_STAGE_ID = '6301070e-7096-42b3-830c-d72dfb586398';
const SEASON6_PLAYOFF_ID = 'c0c0b1fd-fa0b-4488-98b8-be7fdeaee7c0';

const SEASON_SCHEDULE = [
  { name: 'Group Stage', start: 'November 2, 2026', end: 'November 10, 2026', defaultDate: 'November 6, 2026' },
  { name: 'Round 1', start: 'November 2, 2026', end: 'November 4, 2026', defaultDate: 'November 3, 2026', defaultDateTime: 'November 3, 2026 at 8:00 PM EST' },
  { name: 'Round 2', start: 'November 5, 2026', end: 'November 7, 2026', defaultDate: 'November 6, 2026', defaultDateTime: 'November 6, 2026 at 8:00 PM EST' },
  { name: 'Round 3', start: 'November 8, 2026', end: 'November 10, 2026', defaultDate: 'November 9, 2026', defaultDateTime: 'November 9, 2026 at 8:00 PM EST' },
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

  await hydratePersistentTeamRoleMappings();
  if (config.reorganizeExistingMatchChannels) {
    await reorganizeExistingMatchChannels().catch((error) => {
      console.error('[Match reorganization] failed:', error);
    });
  }
  console.log(`Website publisher: ${websitePublisher.mode}${config.websiteEndpoint ? ` -> ${config.websiteEndpoint}` : ' (set WEBSITE_ENDPOINT to publish approvals)'}`);
  console.log(`Schedule sheet: ${scheduleSheet.mode}${config.scheduleSheetWebhookUrl ? '' : ' (set SCHEDULE_SHEET_WEBHOOK_URL to log schedules to Google Sheets)'}`);
  await auditStreamChannelPermissions().catch((error) => console.error('Stream channel audit failed:', error));
  await recoverStreamRequestsOnStartup().catch((error) => console.error('Stream request recovery failed:', error));
  await runOperationsTick().catch((error) => console.error('Operations recovery failed:', error));
  if (!operationsTimer) {
    operationsTimer = setInterval(() => {
      runOperationsTick().catch((error) => console.error('Operations tick failed:', error));
    }, 60_000);
    operationsTimer.unref?.();
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      if (interaction.commandName === 'request') await handleStreamRequestAutocomplete(interaction);
      return;
    }
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'request') {
        await handleStreamRequestCommand(interaction);
        return;
      }
      if (interaction.commandName === 'crossfire') {
        await handleCrossfireCommand(interaction);
        return;
      }
      if (!canUseBotAdminCommand(interaction.member)) {
        await interaction.reply({ content: 'Only admins/match staff can use this bot command.', ephemeral: true });
        return;
      }

      await handleAdminCommand(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('stream_request_open:')) {
      await showStreamRequestModal(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith('stream_request_cancel:')) {
      await handleStreamRequestCancelButton(interaction);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('stream_withdraw_submit:')) {
      await handleStreamWithdrawModal(interaction);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('stream_request_submit:')) {
      await handleStreamRequestModal(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith('stream_review:')) {
      await handleStreamReview(interaction);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('stream_deny_submit:')) {
      await handleStreamDenialModal(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith('stream_delivery_open:')) {
      await handleStreamDeliveryOpen(interaction);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('stream_delivery_submit:')) {
      await handleStreamDeliverySubmit(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith('veto_first:')) {
      await handleVetoFirstChoice(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith('veto_map:')) {
      await handleVetoMapChoice(interaction);
      return;
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

    if (subcommand === 'mappings') {
      await handleTeamMappings(interaction);
      return;
    }

    if (subcommand === 'veto') {
      await handleAdminVeto(interaction);
      return;
    }

    if (subcommand === 'streams') {
      await handleAdminStreams(interaction);
      return;
    }

    if (subcommand === 'auditlog') {
      await handleAuditLog(interaction);
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
  const proposals = await listScheduleProposals();
  const tickets = await listAdminTickets();
  const streams = await listStreamRequests();
  const mappings = await listTeamMappings(teamMappingScope());
  const vetoes = await listVetoes();
  await interaction.reply({
    content: [
      `Known matches: ${matches.length}`,
      `Configured FACEIT source(s): ${config.faceitSources.map((source) => `${source.name} (${source.id})`).join(', ')}`,
      `Pending schedules: ${proposals.filter((entry) => entry.accepted && !entry.adminApproved && !entry.adminDenied).length}`,
      `Open admin tickets: ${tickets.filter((entry) => entry.status === 'open').length}`,
      `Pending streamer requests: ${streams.filter((entry) => ['pending', 'approving'].includes(entry.status)).length}`,
      `Approved coverage: ${streams.filter((entry) => entry.status === 'approved').length}`,
      `Website publish failures needing retry: ${streams.filter((entry) => entry.status === 'publish_failed').length}`,
      `Website publisher: ${websitePublisher.mode}`,
      `Schedule sheet: ${scheduleSheet.mode}`,
      `Persistent team mappings: ${mappings.length}`,
      `Active/blocked vetoes: ${vetoes.filter((entry) => ['choosing_first_action', 'active', 'blocked'].includes(entry.status)).length}`
    ].join('\n'),
    ephemeral: true
  });
}

async function handleCrossfireCommand(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const subcommand = interaction.options.getSubcommand();
  const member = interaction.member;
  const staff = isAdminStaff(member);
  const storedMatches = await listStoredMatches();

  if (subcommand === 'rounds') {
    const configuredRounds = Object.entries(config.roundWindows)
      .map(([name, window]) => `- **${name}**: ${window.start} - ${window.end}`);
    await interaction.editReply(truncateDiscordMessage(configuredRounds.length
      ? configuredRounds.join('\n')
      : `No round windows are configured yet for ${configuredFaceitSourceSummary()}. FACEIT scheduled times will be shown once matches are published.`));
    return;
  }
  if (subcommand === 'help') {
    await interaction.editReply([
      '`/crossfire upcoming` - your upcoming approved matches.',
      '`/crossfire team name:<team>` - that team’s matches when you have access.',
      '`/crossfire rounds` - round windows and defaults.',
      '`/crossfire veto` - veto status for this linked match room.',
      `\`/request stream\` or \`!request\` - request permission to stream (${streamPlatformLabel()} links accepted).`,
      config.streamGuidelinesUrl ? `Streaming guidelines: ${config.streamGuidelinesUrl}` : null,
      config.rulesUrl ? `Rules: ${config.rulesUrl}` : 'Rules link is not configured; ask Tournament Operations for the current rules.'
    ].filter(Boolean).join('\n'));
    return;
  }
  if (subcommand === 'veto') {
    const stored = await getStoredMatchForChannel(interaction.channel);
    if (!stored) {
      await interaction.editReply('Use this inside a linked match room.');
      return;
    }
    const veto = await getVeto(stored.match.id);
    await interaction.editReply(veto ? formatVetoStatus(veto) : 'No veto has started for this match.');
    return;
  }

  const visible = storedMatches.filter((stored) => staff || memberCanSeeStoredMatch(member, stored));
  if (subcommand === 'upcoming') {
    const schedules = new Map((await listSchedules()).map((schedule) => [schedule.matchId, schedule]));
    const rows = visible
      .map((stored) => ({ stored, schedule: schedules.get(stored.match.id) }))
      .filter(({ schedule }) => schedule?.adminApproved && Date.parse(schedule.scheduledAtIso || schedule.scheduledAt) >= Date.now())
      .sort((a, b) => Date.parse(a.schedule.scheduledAtIso || a.schedule.scheduledAt) - Date.parse(b.schedule.scheduledAtIso || b.schedule.scheduledAt));
    await interaction.editReply(truncateDiscordMessage(rows.length
      ? rows.slice(0, 30).map(({ stored, schedule }) => `- **${stored.match.teamA} vs ${stored.match.teamB}**: ${schedule.scheduledAt} <#${stored.discord.channelId}>`).join('\n')
      : 'No upcoming approved matches are visible to you.'));
    return;
  }
  if (subcommand === 'team') {
    const team = interaction.options.getString('name', true);
    const rows = visible.filter((stored) => [stored.match.teamA, stored.match.teamB]
      .some((name) => normalizeTeamKey(name) === normalizeTeamKey(team)));
    if (!rows.length) {
      await interaction.editReply('No matches for that team are visible to you.');
      return;
    }
    const schedules = new Map((await listSchedules()).map((schedule) => [schedule.matchId, schedule]));
    await interaction.editReply(truncateDiscordMessage(rows.slice(0, 40).map((stored) => {
      const schedule = schedules.get(stored.match.id);
      return `- **${stored.match.teamA} vs ${stored.match.teamB}** | ${stored.match.round} | ${schedule?.adminApproved ? `approved: ${schedule.scheduledAt}` : schedule ? 'pending approval' : 'not scheduled'} | <#${stored.discord.channelId}>`;
    }).join('\n')));
  }
}

function memberCanSeeStoredMatch(member, stored) {
  return [stored.discord?.teamARoleId, stored.discord?.teamBRoleId]
    .filter(Boolean)
    .some((roleId) => member.roles.cache.has(roleId));
}

async function handleAuditLog(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const matchId = interaction.options.getString('match_id') || null;
  const entries = (await listAuditLog({ matchId })).slice(-40).reverse();
  await interaction.editReply(truncateDiscordMessage(entries.length
    ? entries.map((entry) => `- ${entry.timestamp} | ${entry.type} | actor ${entry.actorId || 'system'}${entry.matchId ? ` | match ${entry.matchId}` : ''}${entry.reason ? ` | ${entry.reason}` : ''}`).join('\n')
    : 'No matching audit events.'));
}

async function handleCommandHelp(interaction) {
  await interaction.reply({
    content: [
      '**CROSSFIRE Admin Commands**',
      '`/cf sync target:matches` - create/update FACEIT match rooms.',
      '`/cf sync target:matches round:Group Stage - Round 1` - sync one Season 7 group-stage round only.',
      '`/cf sync target:teams` - sync roles, captains, participants, and nicknames from the sheet.',
      '`/cf sync target:teams notify_captains:true` - also DM captains about missing players.',
      '`/cf sync target:teams dry_run:true` - preview roster changes without changing Discord.',
      '`/cf audit target:matches` - check match rooms and permissions without creating channels.',
      '`/cf audit target:matches fix:true` - repair channel names, links, pins, and permissions.',
      '`/cf audit target:players` - show sheet players missing from Discord.',
      '`/cf audit target:captains` - show missing captains.',
      '`/cf refresh` - refresh status emojis on existing match channels.',
      '`/cf status` - show how many matches the bot knows.',
      '`/cf create link:<FACEIT room link>` - create/update one match room.',
      '`/cf sample` - create a sample match room for testing.',
      '`/cf mappings action:list|inspect|link|repair` - manage persistent team-role mappings.',
      '`/cf veto action:start|inspect|reset|cancel|seeds` - manage a playoff veto.',
      '`/cf streams action:pending|approved|inspect|cancel|revoke|complete` - review stream requests.',
      '`/cf auditlog match_id:<optional>` - inspect scheduling and operations decisions.',
      '',
      '**Match Room Commands**',
      '`!schedule November 2 8 PM ET` - propose a match time.',
      '`!propose November 2 8 PM ET` - same as `!schedule`.',
      '`!reschedule November 2 9 PM ET` - request a new time.',
      '`!accept` - accept the open proposal from the other team.',
      '`!decline` - decline the open proposal.',
      '`!admin reason here` or `!calladmin reason here` - alert admins with this match room and FACEIT link.',
      '`!request` - open the community stream request workflow.',
      '`/cf streams action:pending|approved|publish_failed|inspect|retry|cancel|revoke|complete` - manage caster requests and website publishing.',
      '`!cancelreq FACEIT_LINK` or `!cancelreq @caster` - staff cancel grouped or individual approved caster requests.',
      '`!resendip FACEIT_LINK` - staff restart the CSTV/Twitch delivery prompt.',
      '`!sendip FACEIT_LINK MESSAGE` - staff immediately DM connection details or instructions to approved casters.',
      '',
      '**Public Slash Commands**',
      '`/request stream` - submit a stream request; `/request cancel` cancels your pending request.',
      '`/crossfire upcoming|team|rounds|veto|help` - authorized match and event information.'
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

    if (/^!request\b/i.test(content)) {
      await handleTextStreamRequest(message);
    }

    if (/^!cancelreq\b/i.test(content)) {
      await handleCancelStreamRequests(message, content);
    }

    if (/^!resendip\b/i.test(content)) {
      await handleResendStreamDelivery(message, content);
    }

    if (/^!sendip\b/i.test(content)) {
      await handleSendIp(message, content);
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
  const ticket = (await listAdminTickets()).find((entry) => entry.staffMessageId === message.id);
  if (ticket?.status === 'open') {
    await saveAdminTicket({ ...ticket, status: 'claimed', claimedBy: user.id, claimedAt: new Date().toISOString() });
    await appendAuditLog({ type: 'admin_ticket_claimed', matchId: ticket.matchId, actorId: user.id, ticketId: ticket.id });
  }
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
  const ticket = (await listAdminTickets()).find((entry) => entry.staffMessageId === interaction.message.id);
  if (ticket?.status === 'open') {
    await saveAdminTicket({ ...ticket, status: 'claimed', claimedBy: interaction.user.id, claimedAt: new Date().toISOString() });
  }
  await appendAuditLog({ type: 'admin_ticket_claimed', matchId: ticket?.matchId, actorId: interaction.user.id, ticketId: ticket?.id });
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

  const allMatches = (await faceit.getMatches()).map(normalizeConfiguredMatch);
  const matches = filterAndSortMatchesForSync(allMatches, roundFilter);
  let created = 0;
  let skipped = 0;

  if (!config.createMissingMatchTeamRoles) {
    const teamNames = [...new Set(matches.flatMap((match) => [match.teamA, match.teamB]).filter(Boolean))];
    const missingRoleTeams = [];
    for (const teamName of teamNames) {
      const role = await resolveTeamRole(guild, config, teamName);
      if (!role) missingRoleTeams.push(teamName);
    }
    if (missingRoleTeams.length) {
      const roundText = roundFilter?.label || 'all detected rounds';
      await interaction.editReply(truncateDiscordMessage([
        `Match sync stopped before creating any channels for ${roundText}.`,
        `Missing Discord role mappings (${missingRoleTeams.length}): ${missingRoleTeams.join(', ')}`,
        'Run `/cf sync target:teams` first. If a FACEIT name differs from the sheet/Discord role, use `/cf mappings action:link` to connect that FACEIT team name to the correct existing role, then run match sync again.'
      ].join('\n')));
      return;
    }
  }

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
  if (!allMatches.length) {
    await interaction.editReply(`FACEIT has not published any matches yet for ${configuredFaceitSourceSummary()}. No Discord channels were created.`);
    return;
  }
  await interaction.editReply(truncateDiscordMessage([
    `Synced ${created} match channel(s) for ${roundText}. Skipped ${skipped}.`,
    coverage
  ].filter(Boolean).join('\n')));
}

async function handleRefreshMatchStatuses(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const guild = await client.guilds.fetch(config.discordGuildId);
  await guild.channels.fetch();

  const matches = (await faceit.getMatches()).map(normalizeConfiguredMatch);
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
        if (!status.includes('cancel')) await sendPostCastReminder(match.id);
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

  const matches = filterAndSortMatchesForSync((await faceit.getMatches()).map(normalizeConfiguredMatch), roundFilter);
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
    await interaction.editReply(`I could not find that match in the configured FACEIT source(s): ${configuredFaceitSourceSummary()}.`);
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
  const matches = (await faceit.getMatches()).map(normalizeConfiguredMatch);

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
    previousScheduledAt: currentScheduleText(stored),
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

  const expectedCategory = normalizeRoundCategory(match.categoryName || match.round);
  const actualCategory = normalizeRoundCategory(channel.parent?.name || '');
  if (actualCategory !== expectedCategory) {
    problems.push(`wrong category ${channel.parent?.name || 'none'}, expected ${match.categoryName || match.round}`);
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

    const topic = String(channel.topic || '').toLowerCase();
    if ((matchId && topic.includes(matchId)) || (faceitUrl && topic.includes(faceitUrl))) return true;
    if (topic) return false;

    const channelName = normalizeDiscordChannelName(stripMatchStatusPrefix(channel.name));
    const expectedCategory = normalizeRoundCategory(match.categoryName || match.round);
    const actualCategory = normalizeRoundCategory(channel.parent?.name || '');
    return channelName === normalizedExpected && actualCategory === expectedCategory;
  }) || null;
}

async function reorganizeExistingMatchChannels() {
  const guild = await client.guilds.fetch(config.discordGuildId);
  await guild.channels.fetch();

  const matches = filterAndSortMatchesForSync(
    (await faceit.getMatches()).map(normalizeConfiguredMatch),
    null
  );
  const expectedRounds = ['Group Stage - Round 1', 'Group Stage - Round 2', 'Group Stage - Round 3'];
  if (matches.length !== 72) {
    throw new Error(`safety check failed: expected 72 FACEIT matches, received ${matches.length}`);
  }

  const categories = new Map();
  for (const round of expectedRounds) {
    const category = guild.channels.cache.find((channel) =>
      channel.type === ChannelType.GuildCategory
      && normalizeRoundCategory(channel.name) === normalizeRoundCategory(round)
    );
    if (!category) throw new Error(`safety check failed: existing category "${round}" was not found`);
    categories.set(round, category);
  }

  const textChannels = guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildText);
  const byPair = new Map();
  for (const channel of textChannels.values()) {
    const pair = migrationPairFromChannelName(channel.name);
    if (!pair) continue;
    const channels = byPair.get(pair) || [];
    channels.push(channel);
    byPair.set(pair, channels);
  }

  const plan = matches.map((match) => {
    const pair = migrationPairKey(match.teamA, match.teamB);
    const candidates = byPair.get(pair) || [];
    const category = categories.get(match.categoryName || match.round);
    return { match, candidates, category };
  });
  const missing = plan.filter((item) => item.candidates.length === 0);
  const ambiguous = plan.filter((item) => item.candidates.length > 1);
  const uniqueChannelIds = new Set(plan.flatMap((item) => item.candidates.map((channel) => channel.id)));
  if (missing.length || ambiguous.length || uniqueChannelIds.size !== matches.length) {
    throw new Error([
      'safety check failed: existing channel mapping is not exactly one-to-one',
      missing.length ? `missing=${missing.map(({ match }) => `${match.teamA} vs ${match.teamB}`).join(', ')}` : null,
      ambiguous.length ? `ambiguous=${ambiguous.map(({ match }) => `${match.teamA} vs ${match.teamB}`).join(', ')}` : null,
      `uniqueChannels=${uniqueChannelIds.size}`
    ].filter(Boolean).join('; '));
  }

  console.log('[Match reorganization] safety checks passed: 72 matches, 72 existing channels, 3 existing categories.');
  const orderedPlan = [...plan].sort((a, b) => {
    const roundCompare = getGroupStageRoundNumber(a.match) - getGroupStageRoundNumber(b.match);
    const groupCompare = getGroupLetterForMatch(a.match).localeCompare(getGroupLetterForMatch(b.match));
    return roundCompare || groupCompare || Number(a.match.bracketOrder || 0) - Number(b.match.bracketOrder || 0);
  });
  const prepared = [];
  for (const item of orderedPlan) {
    const { match, category } = item;
    const channel = item.candidates[0];
    const stored = await getStoredMatchByChannel(channel.id);
    const wasFinished = hasFinishedChannelPrefix(channel.name);
    const wasScheduled = hasScheduledChannelPrefix(channel.name);
    const migratedMatch = {
      ...match,
      status: wasFinished ? 'finished' : wasScheduled ? 'discord_scheduled' : match.status,
      scheduledByDiscord: wasScheduled || Boolean(stored?.match?.scheduledByDiscord),
      scheduledAt: wasScheduled || stored?.match?.scheduledByDiscord
        ? stored?.match?.scheduledAt || match.scheduledAt || null
        : match.scheduledAt || null
    };
    await relinkMatchChannel(migratedMatch, {
      ...(stored?.discord || {}),
      channelId: channel.id,
      categoryId: category.id
    });
    prepared.push({ match: migratedMatch, channelId: channel.id, category });
  }
  console.log('[Match reorganization] relinked persistent state for 72 existing channels.');

  const proposals = await listScheduleProposals();
  for (const item of prepared) {
    item.pending = proposals
      .filter((proposal) =>
        proposal.matchId === item.match.id
        && !proposal.declined
        && !proposal.adminDenied
        && !proposal.adminApproved
      )
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0] || null;
  }

  async function runMigrationBatches(items, batchSize, callback) {
    for (let index = 0; index < items.length; index += batchSize) {
      await Promise.all(items.slice(index, index + batchSize).map(callback));
    }
  }

  await runMigrationBatches(prepared, 12, async (item) => {
    const channel = guild.channels.cache.get(item.channelId);
    if (channel?.parentId === item.category.id) return;
    await client.rest.patch(Routes.channel(item.channelId), {
      body: { parent_id: item.category.id, lock_permissions: false }
    });
  });
  console.log('[Match reorganization] moved 72 existing channels into their target round categories.');

  await runMigrationBatches(prepared, 12, async (item) => {
    let topic = makeMigratedMatchChannelTopic(item.match);
    if (item.pending) {
      topic = [topic, `${PENDING_SCHEDULE_TOPIC_PREFIX}${encodePendingSchedule(item.pending)}`]
        .filter(Boolean)
        .join(' | ')
        .slice(0, 1024);
    }
    await client.rest.patch(Routes.channel(item.channelId), {
      body: {
        name: makeMatchChannelName(item.match),
        topic
      }
    });
  });
  console.log('[Match reorganization] updated 72 existing channel names and FACEIT topics.');

  await guild.channels.fetch();
  const roundOffsets = new Map();
  await guild.channels.setPositions(prepared.map((item) => {
    const round = item.match.categoryName || item.match.round;
    const offset = roundOffsets.get(round) || 0;
    roundOffsets.set(round, offset + 1);
    return {
      channel: item.channelId,
      position: item.category.rawPosition + offset + 1
    };
  }));
  console.log('[Match reorganization] ordered channels by round and Group A-L.');

  await runMigrationBatches(prepared, 6, async (item) => {
    const channel = guild.channels.cache.get(item.channelId);
    if (channel?.isTextBased?.()) await upsertMatchIntroMessage(channel, item.match);
  });
  console.log('[Match reorganization] updated existing pinned intro messages.');

  console.log('[Match reorganization] completed successfully: moved/relinked 72 existing channels; created 0 channels.');
}

function migrationTeamKey(value) {
  const normalized = normalizeTeamKey(value);
  return normalized === 'vlandian knights' ? 'vlandian knigts' : normalized;
}

function migrationPairKey(teamA, teamB) {
  return [migrationTeamKey(teamA), migrationTeamKey(teamB)].sort().join('|');
}

function migrationPairFromChannelName(value) {
  const normalized = normalizeDiscordChannelName(stripMatchStatusPrefix(value))
    .replace(/^[a-l]-/, '');
  const teams = normalized.split('-vs-');
  return teams.length === 2 ? migrationPairKey(teams[0], teams[1]) : '';
}

function makeMigratedMatchChannelTopic(match) {
  return [
    `Round: ${match.round}`,
    match.scheduledAt ? `FACEIT schedule: ${match.scheduledAt}` : 'FACEIT schedule: not set',
    match.faceitUrl ? `Room: ${match.faceitUrl}` : null
  ].filter(Boolean).join(' | ').slice(0, 1024);
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

function normalizeConfiguredMatch(match) {
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
  return Boolean(match.source?.id && config.playoffSourceIds.includes(match.source.id));
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
  const manualOrder = match.source?.id === SEASON6_PLAYOFF_ID
    ? SEASON6_WB_ROUND_OF_32_PAIR_ORDER.get(matchPairKey(match.teamA, match.teamB))
    : null;
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
  return Number.isInteger(rawRound) && rawRound > 0 ? rawRound : 999;
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
      return `Group Stage - Round ${round}: detected groups ${sortedGroups.join(', ')}.`;
    })
    .join('\n');
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
  const round = Number(value);
  return Number.isInteger(round) && round > 0 ? round : 1;
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
  const dryRun = interaction.options.getBoolean('dry_run') || false;
  await interaction.editReply(
    `${dryRun ? 'Previewing' : 'Started syncing'} team roles from Google Sheet... Captain DMs: **${notifyCaptains && !dryRun ? 'on' : 'off'}**.`
  );

  const guild = await client.guilds.fetch(config.discordGuildId);
  let lastProgressAt = 0;
  const result = await syncRolesFromSheet(
    guild,
    config,
    { notifyCaptains: notifyCaptains && !dryRun, dryRun },
    async (progress) => {
      const now = Date.now();
      if (now - lastProgressAt < 2500 && progress.current !== progress.total) return;
      lastProgressAt = now;

      await interaction.editReply(
        `Syncing team roles... ${progress.current}/${progress.total} teams checked. Created ${progress.rolesCreated} role(s), added ${progress.added} team role assignment(s), ${progress.participantAdded} participant assignment(s), ${progress.captainAdded} captain assignment(s), removed ${progress.removed} stale role assignment(s). Captain DMs: **${notifyCaptains ? 'on' : 'off'}**.`
      ).catch(() => null);
    }
  );

  if (dryRun) {
    await interaction.editReply(truncateDiscordMessage([
      `Dry run complete. No roles, nicknames, or mappings were changed. ${result.totalTeams || 0} team row(s) checked.`,
      ...(result.plannedChanges || []).slice(0, 30).map((line) => `- ${line}`),
      result.duplicateEntries?.length ? `Duplicates: ${result.duplicateEntries.join(', ')}` : null
    ].filter(Boolean).join('\n')));
    return;
  }

  await hydratePersistentTeamRoleMappings();

  const missingLine = result.missingMembers?.length
    ? `\nCould not find these Discord users: ${result.missingMembers.join(', ')}`
    : '';
  const failedLine = result.failedActions?.length
    ? `\nCould not complete these actions: ${result.failedActions.join(', ')}`
    : '';
  const duplicateLine = result.duplicateEntries?.length
    ? `\nDuplicate sheet identities: ${result.duplicateEntries.join(', ')}`
    : '';
  const unresolvedLine = result.unresolvedTeams?.length
    ? `\nUnresolved teams: ${result.unresolvedTeams.join(', ')}`
    : '';

  await interaction.editReply(truncateDiscordMessage(
    `Synced team roles from Google Sheet. Created ${result.rolesCreated} role(s), added ${result.added} team role assignment(s), ${result.participantAdded} season participant assignment(s), ${result.captainAdded} captain role assignment(s), removed ${result.removed} stale role assignment(s), changed ${result.nicknamesChanged} nickname(s), sent ${result.captainDmsSent} captain DM(s). Skipped ${result.skipped}.${missingLine}${failedLine}${duplicateLine}${unresolvedLine}`
  ));
}

function teamMappingScope() {
  return getTeamMappingScope(config, config.discordGuildId);
}

async function hydratePersistentTeamRoleMappings() {
  const mappings = await listTeamMappings(teamMappingScope());
  for (const mapping of mappings) {
    if (!mapping.discordRoleId) continue;
    for (const alias of [mapping.teamName, ...(mapping.aliases || [])].filter(Boolean)) {
      config.teamRoleIds.set(normalizeTeamKey(alias), mapping.discordRoleId);
    }
  }
}

async function handleTeamMappings(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const action = interaction.options.getString('action', true);
  const query = interaction.options.getString('team')?.trim() || '';
  const mappings = await listTeamMappings(teamMappingScope());

  if (action === 'list' || action === 'inspect') {
    const filtered = query
      ? mappings.filter((mapping) => [mapping.identity, mapping.teamName, ...(mapping.aliases || [])]
        .some((value) => normalizeTeamKey(value).includes(normalizeTeamKey(query))))
      : mappings;
    const lines = filtered.slice(0, 40).map((mapping) =>
      `- **${mapping.teamName}** | identity: ${mapping.identity} | role: ${mapping.discordRoleId ? `<@&${mapping.discordRoleId}>` : 'missing'} | captains: ${(mapping.captainDiscordIds || []).length} | players: ${(mapping.playerDiscordIds || []).length}`
    );
    await interaction.editReply(truncateDiscordMessage(lines.length ? lines.join('\n') : 'No matching persistent team mappings found.'));
    return;
  }

  if (action === 'link') {
    const role = interaction.options.getRole('role');
    const faceitTeamId = interaction.options.getString('faceit_team_id')?.trim().toLowerCase() || '';
    if (!query || !role) {
      await interaction.editReply('For link/correct, provide `team` and `role`. Add `faceit_team_id` when available.');
      return;
    }
    const existing = mappings.find((mapping) =>
      (faceitTeamId && mapping.faceitTeamId === faceitTeamId) ||
      [mapping.teamName, ...(mapping.aliases || [])].some((value) => normalizeTeamKey(value) === normalizeTeamKey(query))
    );
    const identity = faceitTeamId || existing?.identity || `name:${normalizeTeamKey(query)}`;
    const saved = await saveTeamMapping(teamMappingScope(), {
      ...(existing || {}),
      identity,
      teamName: query,
      faceitTeamId: faceitTeamId || existing?.faceitTeamId || null,
      discordRoleId: role.id,
      aliases: [...(existing?.aliases || []), existing?.teamName, query].filter(Boolean),
      source: 'admin_link'
    });
    await hydratePersistentTeamRoleMappings();
    await appendAuditLog({ type: 'team_mapping_link', actorId: interaction.user.id, identity, teamName: query, roleId: role.id });
    await interaction.editReply(`Saved mapping: **${saved.teamName}** -> <@&${saved.discordRoleId}> (identity ${saved.identity}). Existing aliases were preserved.`);
    return;
  }

  if (action === 'repair') {
    const guild = await client.guilds.fetch(config.discordGuildId);
    await guild.channels.fetch();
    await guild.roles.fetch();
    let repaired = 0;
    const failures = [];
    for (const stored of await listStoredMatches()) {
      const channel = stored.discord?.channelId ? await guild.channels.fetch(stored.discord.channelId).catch(() => null) : null;
      if (!channel) continue;
      try {
        const discordIds = await repairMatchChannel(guild, config, channel, stored.match);
        await saveMatch(stored.match, discordIds);
        repaired += 1;
      } catch (error) {
        failures.push(`${stored.match.teamA} vs ${stored.match.teamB}: ${error.message}`);
      }
    }
    await interaction.editReply(truncateDiscordMessage(`Repaired ${repaired} linked match room(s). Failures: ${failures.length}.${failures.length ? `\n${failures.slice(0, 10).join('\n')}` : ''}`));
  }
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

  const rawProposedText = content.replace(/^!(schedule|propose|reschedule)\s*/i, '').trim();
  const forceDirective = parseForceDirective(rawProposedText);
  const proposedText = forceDirective.scheduleText;
  if (!proposedText) {
    await message.reply(`Use it like this: \`!${kind === 'reschedule' ? 'reschedule' : 'schedule'} 8/24/2026 3 PM EST\` or \`!${kind === 'reschedule' ? 'reschedule' : 'schedule'} Tuesday 8 PM ET\``);
    return;
  }

  const parsedSchedule = parseScheduleInput(proposedText);
  const validation = validateScheduleRequest(stored, proposedText, kind, parsedSchedule?.date || null);
  const bypassPolicy = canScheduleDirectly && !validation.allowed && Boolean(forceDirective.reason);
  if (!validation.allowed && !bypassPolicy) {
    if (canScheduleDirectly) {
      await message.reply(`${validation.message} To override it, add --force reason here after the time.`);
      return;
    }
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
    override: canScheduleDirectly,
    overrideReason: bypassPolicy ? forceDirective.reason : null,
    previousMatchStatus: stored.match.status || null,
    previousScheduledAt: stored.match.scheduledAt || null,
    previousScheduledByDiscord: Boolean(stored.match.scheduledByDiscord)
  };

  await saveScheduleProposal(proposal);

  if (canScheduleDirectly) {
    const faceitLine = await applyAcceptedSchedule(message.channel, stored, proposal, message.author.id);
    await appendAuditLog({
      type: 'ops_schedule_submitted',
      matchId: stored.match.id,
      actorId: message.author.id,
      oldTime: currentScheduleText(stored),
      newTime: proposal.scheduledAt,
      newTimeIso: proposal.scheduledAtIso,
      override: bypassPolicy,
      reason: proposal.overrideReason || 'Tournament Ops submitted without team acceptance'
    });
    await message.channel.send({
      content: `<@&${stored.discord.teamARoleId}> <@&${stored.discord.teamBRoleId}>`,
      embeds: [scheduleStatusEmbed({
        title: kind === 'reschedule' ? 'Reschedule Submitted By Tournament Ops' : 'Schedule Submitted By Tournament Ops',
        color: EMBED_COLORS.warning,
        stored,
        proposal,
        actorLabel: 'Submitted By',
        actorId: message.author.id,
        footer: 'Pending admin approval. The match is not marked scheduled yet.',
        warning: [validation.warning, proposal.overrideReason ? `Policy override: ${proposal.overrideReason}` : null].filter(Boolean).join('\n') || null
      })],
      allowedMentions: { roles: [stored.discord.teamARoleId, stored.discord.teamBRoleId], users: [], repliedUser: false }
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
    const alert = await adminChannel.send({
      content: staffMentions,
      embeds: [alertEmbed],
      allowedMentions,
      components: [callAdminClaimButton(message.channel.id)]
    });
    await saveAdminTicket({
      id: `ticket-${alert.id}`,
      status: 'open',
      matchId: stored.match.id,
      matchChannelId: message.channel.id,
      staffChannelId: adminChannel.id,
      staffMessageId: alert.id,
      requestedBy: message.author.id,
      reason
    });
    await message.reply('Admins have been notified.');
    return;
  }

  const alert = await message.channel.send({
    content: staffMentions,
    embeds: [alertEmbed],
    allowedMentions,
    components: [callAdminClaimButton(message.channel.id)]
  });
  await saveAdminTicket({
    id: `ticket-${alert.id}`,
    status: 'open',
    matchId: stored.match.id,
    matchChannelId: message.channel.id,
    staffChannelId: message.channel.id,
    staffMessageId: alert.id,
    requestedBy: message.author.id,
    reason
  });
}

function streamRequestChannelAllowed(channelId) {
  return !config.streamCommunityChannelIds.length || config.streamCommunityChannelIds.includes(channelId);
}

function streamCommunityChannelHint() {
  return `Please request streams in ${config.streamCommunityChannelIds.map((id) => `<#${id}>`).join(' or ')}.`;
}

async function handleTextStreamRequest(message) {
  if (!streamRequestChannelAllowed(message.channelId)) {
    await message.reply(streamCommunityChannelHint());
    return;
  }
  await message.reply({
    content: [
      '**Stream Request**',
      'Submitting a request does not grant permission to stream.',
      config.streamGuidelinesUrl ? `Guidelines: ${config.streamGuidelinesUrl}` : config.streamGuidelinesText
    ].join('\n'),
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`stream_request_open:${message.author.id}`)
        .setLabel('Request to Stream')
        .setStyle(ButtonStyle.Primary)
    )]
  });
}

async function handleStreamRequestCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'cancel') {
    const requestId = interaction.options.getString('request_id', true).trim();
    const request = await getStreamRequest(requestId);
    if (!request || request.requesterId !== interaction.user.id || !STREAM_ACTIVE_STATUSES.includes(request.status)) {
      await interaction.reply({ content: 'I could not find an active request with that ID belonging to you.', ephemeral: true });
      return;
    }
    if (STREAM_WITHDRAWABLE_STATUSES.includes(request.status)) {
      await interaction.showModal(streamWithdrawModal(request));
      return;
    }
    const updated = await cancelPendingStreamRequest(request, interaction.user.id);
    if (!updated) {
      await interaction.reply({ content: 'This request is no longer active.', ephemeral: true });
      return;
    }
    await interaction.reply({ content: `Canceled stream request ${requestId}.`, ephemeral: true });
    return;
  }
  if (!streamRequestChannelAllowed(interaction.channelId)) {
    await interaction.reply({ content: streamCommunityChannelHint(), ephemeral: true });
    return;
  }
  await showStreamRequestModal(interaction);
}

function streamPlatformLabel() {
  const platforms = config.streamAllowedPlatforms.length ? config.streamAllowedPlatforms : ['twitch', 'youtube', 'kick'];
  return platforms.map((platform) => ({ twitch: 'Twitch', youtube: 'YouTube', kick: 'Kick' }[platform] || platform)).join('/');
}

// Notes from the post-cast form check at form-open time, picked up when the request is
// created so staff see them on the card. Keyed by requester; lost on restart, which is fine.
const postCastGateNotes = new Map();

async function showStreamRequestModal(interaction) {
  const parts = interaction.customId?.split(':') || [];
  const boundRequester = parts[1] || interaction.user.id;
  if (boundRequester !== interaction.user.id) {
    await interaction.reply({ content: 'Use your own Request to Stream button.', ephemeral: true });
    return;
  }
  const gate = await checkPostCastFormGate(interaction.user.id);
  if (gate.blocked) {
    await interaction.reply({ content: gate.message, ephemeral: true });
    await appendAuditLog({ type: 'stream_request_blocked_post_cast_form', actorId: interaction.user.id, requestId: gate.outstanding.id, matchId: gate.outstanding.matchId }).catch(() => null);
    return;
  }
  if (gate.note) postCastGateNotes.set(interaction.user.id, gate.note);
  else postCastGateNotes.delete(interaction.user.id);
  const stored = interaction.channel?.id ? await getStoredMatchForChannel(interaction.channel) : null;
  const modal = new ModalBuilder()
    .setCustomId(makeStreamRequestModalId(interaction.user.id, interaction.channelId))
    .setTitle('Request to Stream');
  const fields = [
    ['faceit_url', 'FACEIT matchroom link', stored?.match?.faceitUrl || '', TextInputStyle.Short],
    ['stream_url', `${streamPlatformLabel()} channel URL`.slice(0, 45), '', TextInputStyle.Short],
    ['social_url', 'Your X / Twitter profile URL', '', TextInputStyle.Short]
  ];
  const placeholders = {
    faceit_url: 'Example: https://www.faceit.com/en/cs2/room/1-...',
    stream_url: 'Example: https://twitch.tv/yourchannel',
    social_url: 'Example: https://x.com/yourhandle'
  };
  const maxLengths = { faceit_url: 500, stream_url: 500, social_url: 500 };
  modal.addComponents(...fields.map(([id, label, value, style]) => {
    const input = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(true);
    input.setPlaceholder(placeholders[id]);
    input.setMaxLength(maxLengths[id]);
    if (value) input.setValue(String(value).slice(0, maxLengths[id]));
    return new ActionRowBuilder().addComponents(input);
  }));
  await interaction.showModal(modal);
}

async function handleStreamRequestModal(interaction) {
  const modalContext = parseStreamRequestModalId(interaction.customId);
  if (!modalContext) {
    await interaction.reply({ content: 'This stream request form is invalid. Please open a new one.', ephemeral: true });
    return;
  }
  const { requesterId, sourceChannelId } = modalContext;
  if (requesterId !== interaction.user.id) {
    await interaction.reply({ content: 'This form belongs to another user.', ephemeral: true });
    return;
  }
  const linkedMatch = sourceChannelId === 'none'
    ? null
    : await getStoredMatchByChannel(sourceChannelId);
  const submittedFaceitUrl = interaction.fields.getTextInputValue('faceit_url');
  const parsedFaceitLink = parseFaceitMatchRoomLink(submittedFaceitUrl);
  let verifiedFaceitMatch = null;
  let faceitValidationError = null;
  if (parsedFaceitLink) {
    try {
      verifiedFaceitMatch = await faceit.getMatch(parsedFaceitLink.matchId);
      if (!verifiedFaceitMatch) faceitValidationError = 'FACEIT returned no usable match details for this room.';
    } catch (error) {
      faceitValidationError = `FACEIT could not verify this matchroom: ${error.message}`;
    }
  } else {
    faceitValidationError = 'The supplied URL is not a valid FACEIT CS2 matchroom link.';
  }
  const matchId = verifiedFaceitMatch?.id || null;
  const expectedMatchup = verifiedFaceitMatch
    ? `${verifiedFaceitMatch.teamA} vs ${verifiedFaceitMatch.teamB}`
    : linkedMatch ? `${linkedMatch.match.teamA} vs ${linkedMatch.match.teamB}` : null;
  const verifiedScheduleIso = getFaceitScheduledAtIso(verifiedFaceitMatch);
  const derivedMatchup = expectedMatchup || 'Unknown matchup - FACEIT link not verified';
  const derivedDateTime = verifiedScheduleIso
    ? formatEasternDateTimeInput(verifiedScheduleIso)
    : 'Not scheduled on FACEIT yet';
  const validation = validateStreamRequest({
    dateTime: derivedDateTime,
    matchup: derivedMatchup,
    streamUrl: interaction.fields.getTextInputValue('stream_url'),
    socialUrl: interaction.fields.getTextInputValue('social_url'),
    allowedPlatforms: config.streamAllowedPlatforms,
    matchDetailsRequired: false
  });
  if (!validation.valid) {
    await interaction.reply({
      content: `Your request was not submitted. Please fix the following and try again:\n${validation.errors.map((error) => `• ${error}`).join('\n')}`,
      ephemeral: true
    });
    return;
  }
  if (!config.streamRequestChannelId) {
    await interaction.reply({ content: 'Stream requests are temporarily unavailable because the staff review channel is not configured.', ephemeral: true });
    return;
  }
  const staffChannel = await client.channels.fetch(config.streamRequestChannelId).catch(() => null);
  const priorRequests = (await listStreamRequests({ requesterId: interaction.user.id })).filter((entry) =>
    matchId ? entry.matchId === matchId : normalizeTeamKey(entry.matchup) === normalizeTeamKey(validation.value.matchup)
  );
  const creation = await createStreamRequestUnlessActive({
    id: makeStreamRequestId(),
    requesterId: interaction.user.id,
    requesterTag: interaction.user.tag,
    matchId,
    sourceChannelId: sourceChannelId === 'none' ? interaction.channelId : sourceChannelId,
    faceitUrl: parsedFaceitLink?.url || submittedFaceitUrl.trim(),
    faceitLinkValid: Boolean(verifiedFaceitMatch),
    faceitValidationError,
    faceitScheduledAtIso: verifiedScheduleIso,
    faceitStatus: verifiedFaceitMatch?.status || null,
    faceitLastCheckedAt: verifiedFaceitMatch ? new Date().toISOString() : null,
    manualVerificationRequired: !verifiedFaceitMatch,
    repeatSubmission: priorRequests.length > 0,
    priorSubmissionCount: priorRequests.length,
    postCastFormNote: postCastGateNotes.get(interaction.user.id) || null,
    ...validation.value,
    guidelinesSnapshot: config.streamGuidelinesText,
    guidelinesUrl: config.streamGuidelinesUrl
  });
  const request = creation.request;
  postCastGateNotes.delete(interaction.user.id);
  if (!creation.created) {
    await interaction.reply({
      content: `You already have active request **${request.id}** for this FACEIT match. Its status is **${request.status}**. Cancel it before submitting another request.`,
      components: [streamRequesterCancelRow(request)],
      ephemeral: true
    });
    return;
  }
  let posted = false;
  try {
    await sendStreamRequestToStaff(request, staffChannel?.isTextBased?.() ? staffChannel : null);
    posted = true;
  } catch (error) {
    // Keep the request pending; startup recovery and the operations tick re-post it.
    console.error(`Could not post stream request ${request.id} to staff review:`, error);
    await updateStreamRequest(request.id, { staffPostError: error.message }, ['pending']);
  }
  await appendAuditLog({ type: 'stream_request_submitted', actorId: interaction.user.id, matchId: request.matchId, requestId: request.id, posted });
  await interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor(EMBED_COLORS.warning)
      .setTitle('Stream Request Submitted')
      .setDescription(posted
        ? `Request **${request.id}** is waiting for staff review. This is **not** permission to stream yet; you will be notified when a decision is made.`
        : `Request **${request.id}** was saved, but I could not reach the staff review channel. It will be delivered automatically once that is fixed; please tell an admin.`)
      .addFields(
        { name: 'Match', value: request.matchup },
        { name: 'Schedule', value: formatScheduleForDiscord(request.faceitScheduledAtIso || request.dateTimeIso, request.dateTime) },
        { name: 'FACEIT Matchroom', value: request.faceitUrl },
        { name: 'Stream', value: `${request.streamUrl} (${request.streamPlatform || 'unknown platform'})` }
      )],
    components: [streamRequesterCancelRow(request)],
    ephemeral: true
  });
}

function streamRequesterCancelRow(request) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`stream_request_cancel:${request.id}:${request.requesterId}`)
      .setLabel('Cancel Request')
      .setStyle(ButtonStyle.Danger)
  );
}

// Shown on the approval DM and the public approval post. Same handler as the cancel
// button; it opens the withdrawal form because the request is already approved.
function streamCasterWithdrawRow(request) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`stream_request_cancel:${request.id}:${request.requesterId}`)
      .setLabel('Withdraw from this cast')
      .setStyle(ButtonStyle.Danger)
  );
}

function streamWithdrawModal(request) {
  return new ModalBuilder()
    .setCustomId(`stream_withdraw_submit:${request.id}`)
    .setTitle('Withdraw from this cast')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Why are you pulling out? (optional)')
        .setPlaceholder('Staff see this so they can find a replacement caster.')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(500)
        .setRequired(false)
    ));
}

async function handleStreamRequestCancelButton(interaction) {
  const [, requestId, requesterId] = interaction.customId.split(':');
  if (interaction.user.id !== requesterId) {
    await interaction.reply({ content: 'Only the caster who made this request can cancel or withdraw it.', ephemeral: true });
    return;
  }
  const request = await getStreamRequest(requestId);
  if (!request || !STREAM_ACTIVE_STATUSES.includes(request.status)) {
    await interaction.reply({ content: 'This request is no longer active.', ephemeral: true });
    return;
  }
  if (STREAM_WITHDRAWABLE_STATUSES.includes(request.status)) {
    await interaction.showModal(streamWithdrawModal(request));
    return;
  }
  const updated = await cancelPendingStreamRequest(request, interaction.user.id);
  if (!updated) {
    await interaction.update({ content: 'This request is no longer active.', embeds: [], components: [] });
    return;
  }
  await interaction.update({ content: `Canceled stream request **${requestId}**.`, embeds: [], components: [] });
}

// A request that staff have not approved yet just goes away quietly.
async function cancelPendingStreamRequest(request, actorId) {
  const updated = await updateStreamRequest(request.id, {
    status: 'canceled',
    canceledBy: actorId,
    canceledAt: new Date().toISOString()
  }, STREAM_ACTIVE_STATUSES.filter((status) => !STREAM_WITHDRAWABLE_STATUSES.includes(status)));
  if (!updated) return null;
  await refreshStreamRequestStaffMessage(updated);
  await syncStreamRequestToWebsite(updated, 'canceled');
  await appendAuditLog({ type: 'stream_request_canceled_by_requester', actorId, matchId: updated.matchId, requestId: updated.id });
  return updated;
}

// A caster pulling out of an approved cast: delist on the website, take the link off the
// sheet, tell the community channel, and ping staff so they can find a replacement.
async function handleStreamWithdrawModal(interaction) {
  const requestId = interaction.customId.split(':')[1];
  const reason = normalizeWithdrawalReason(interaction.fields.getTextInputValue('reason'));
  await interaction.deferReply({ ephemeral: true });
  const current = await getStreamRequest(requestId);
  if (!current || current.requesterId !== interaction.user.id) {
    await interaction.editReply('Only the caster who made this request can withdraw it.');
    return;
  }
  const exit = classifyCasterExit(current);
  const updated = await updateStreamRequest(requestId, {
    status: 'withdrawn',
    withdrawnBy: interaction.user.id,
    withdrawnAt: new Date().toISOString(),
    denialReason: reason
  }, STREAM_WITHDRAWABLE_STATUSES);
  if (!updated) {
    await interaction.editReply(`Request ${requestId} is no longer an approved cast, so there is nothing to withdraw from.`);
    return;
  }
  await interaction.message?.edit({ components: [] }).catch(() => null);
  await refreshStreamRequestStaffMessage(updated);
  await syncStreamRequestToWebsite(updated, 'canceled');
  const sheetWarning = await removeStreamLinkFromSheet(updated, interaction.user.id);
  const remainingCasters = updated.matchId
    ? (await listStreamRequests({ matchId: updated.matchId, status: 'approved' })).length
    : 0;
  await appendAuditLog({ type: 'stream_request_withdrawn', actorId: interaction.user.id, matchId: updated.matchId, requestId, reason, late: Boolean(exit?.late), remainingCasters });

  const scheduleIso = updated.faceitScheduledAtIso || updated.dateTimeIso;
  await postToStreamOrigin(updated, {
    embeds: [new EmbedBuilder()
      .setColor(0x7f8c8d)
      .setTitle(`↩️ Cast withdrawn: ${updated.matchup}`)
      .setDescription(`<@${updated.requesterId}> will no longer be casting this match.`)
      .addFields(
        { name: 'When', value: formatScheduleForDiscord(scheduleIso, updated.dateTime || 'Not scheduled on FACEIT yet'), inline: false },
        remainingCasters > 0
          ? { name: 'Other casters', value: `${remainingCasters} other approved cast(s) remain for this match.`, inline: false }
          : { name: 'Open for requests', value: 'Nobody is casting this match now. Casters may submit a new request.', inline: false }
      )
      .setFooter({ text: `Request ${updated.id}` })
      .setTimestamp()]
  });
  const hoursText = Number.isFinite(exit?.hoursUntilMatch)
    ? (exit.hoursUntilMatch < 0 ? 'the match has already started' : `the match is in ${Math.max(1, Math.round(exit.hoursUntilMatch))} hour(s)`)
    : null;
  await alertStreamStaff([
    `↩️ <@${updated.requesterId}> withdrew from casting **${updated.matchup}** (request ${updated.id}).`,
    `When: ${formatScheduleForDiscord(scheduleIso, updated.dateTime || 'Not scheduled on FACEIT yet')}`,
    `Reason: ${reason}`,
    exit?.late ? `⚠️ **LATE WITHDRAWAL** - ${hoursText}.` : null,
    remainingCasters > 0 ? `${remainingCasters} other approved cast(s) remain for this match.` : '**This match has no caster now.**',
    sheetWarning ? `⚠️ ${sheetWarning}` : null
  ].filter(Boolean).join('\n'));
  await interaction.editReply([
    `You have withdrawn from casting **${updated.matchup}**. Staff and the community channel have been told.`,
    sheetWarning ? `⚠️ ${sheetWarning}` : null
  ].filter(Boolean).join('\n'));
}

// Offers the caster's own active requests for /request cancel.
async function handleStreamRequestAutocomplete(interaction) {
  const focused = String(interaction.options.getFocused() || '').toLowerCase();
  const requests = (await listStreamRequests({ requesterId: interaction.user.id }))
    .filter((request) => STREAM_ACTIVE_STATUSES.includes(request.status))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const choices = requests
    .map((request) => ({
      name: `${request.id} · ${request.matchup} · ${STREAM_WITHDRAWABLE_STATUSES.includes(request.status) ? 'approved cast' : 'pending'}`.slice(0, 100),
      value: request.id
    }))
    .filter((choice) => !focused || choice.name.toLowerCase().includes(focused) || choice.value.toLowerCase().includes(focused))
    .slice(0, 25);
  await interaction.respond(choices).catch(() => null);
}

async function sendStreamRequestToStaff(request, suppliedChannel = null) {
  const channel = suppliedChannel || (config.streamRequestChannelId
    ? await client.channels.fetch(config.streamRequestChannelId).catch(() => null)
    : null);
  if (!channel?.isTextBased?.()) throw new Error('STREAM_REQUEST_CHANNEL_ID is not configured or accessible');
  const embed = streamRequestEmbed(request);
  const message = await channel.send({
    content: getStaffMentions(channel.guild),
    embeds: [embed],
    components: streamReviewComponents(request),
    allowedMentions: getAdminAllowedMentions(channel.guild)
  });
  await updateStreamRequest(request.id, { staffChannelId: channel.id, staffMessageId: message.id, staffPostError: null }, ['pending']);
}

function postCastFormLinkFor(requestId) {
  return postCastFormLink(config.postCastFormPrefillUrl, config.postCastFormUrl, requestId);
}

// Decides whether a caster may open the request form. Blocks when their most recent
// finished cast has no post-cast form response. Sheet failures let the caster through
// and leave a note for staff on the next request card instead of locking people out.
async function checkPostCastFormGate(requesterId) {
  if (!config.postCastFormGate) return { blocked: false, note: null };
  const outstanding = findOutstandingPostCast(await listStreamRequests({ requesterId }), { requesterId, since: config.postCastFormGateSince });
  if (!outstanding) return { blocked: false, note: null };

  const lookup = await scheduleSheet.lookupPostCastForms([outstanding.id])
    .catch((error) => ({ ok: false, skipped: false, error: error?.message || String(error), found: {} }));
  const hit = lookup.ok ? lookup.found?.[outstanding.id] : null;
  if (hit) {
    await updateStreamRequest(outstanding.id, {
      postCastFormSubmittedAt: hit.submittedAt || new Date().toISOString(),
      postCastFormSource: 'form'
    });
    return { blocked: false, note: `Form received for last cast ${outstanding.id} (${outstanding.matchup}).` };
  }
  if (!lookup.ok || lookup.skipped) {
    const why = lookup.skipped ? 'sheet lookups are in log-only mode' : lookup.error;
    console.error(`Post-cast form check for ${outstanding.id} could not run: ${why}`);
    return { blocked: false, note: `⚠️ Could not verify the form for last cast ${outstanding.id} (${outstanding.matchup}): ${why}` };
  }
  return {
    blocked: true,
    outstanding,
    note: null,
    message: [
      `⛔ Before you can request another stream, please submit the post-cast stats form for your last cast, **${outstanding.matchup}** (request ${outstanding.id}).`,
      `Form, with your request ID already filled in: ${postCastFormLinkFor(outstanding.id)}`,
      'Once it is submitted, try again. If you already sent the form without the request ID, ask staff to mark it received.'
    ].join('\n')
  };
}

function streamRequestEmbed(request) {
  const status = request.status || 'pending';
  const colors = {
    pending: EMBED_COLORS.warning,
    approving: 0x5865f2,
    approved: EMBED_COLORS.accepted,
    publish_failed: EMBED_COLORS.declined,
    denied: 0x7f8c8d,
    revoked: EMBED_COLORS.declined,
    canceled: 0x7f8c8d,
    withdrawn: 0x7f8c8d,
    expired: 0x7f8c8d,
    submission_failed: EMBED_COLORS.declined
  };
  const scheduleIso = request.faceitScheduledAtIso || request.dateTimeIso;
  const fields = [
    { name: 'Caster', value: `<@${request.requesterId}>${request.requesterTag ? ` (${request.requesterTag})` : ''}`, inline: true },
    { name: 'Match', value: request.matchup, inline: true },
    { name: 'Date/Time', value: formatScheduleForDiscord(scheduleIso, request.dateTime || 'Not scheduled on FACEIT yet'), inline: false },
    { name: 'FACEIT Matchroom', value: request.faceitUrl || 'Not supplied', inline: false },
    { name: `Stream${request.streamPlatform ? ` (${request.streamPlatform})` : ''}`, value: request.streamUrl, inline: false },
    { name: 'X / Twitter', value: request.socialUrl, inline: false },
    request.reviewedBy ? { name: 'Decided By', value: `<@${request.reviewedBy}>`, inline: true } : null,
    request.websiteId && status === 'approved' ? { name: 'Website ID', value: String(request.websiteId), inline: true } : null,
    request.denialReason && ['denied', 'revoked', 'canceled', 'withdrawn', 'expired'].includes(status)
      ? { name: 'Reason', value: request.denialReason, inline: false }
      : null,
    status === 'publish_failed'
      ? { name: 'Last website error', value: `\`\`\`${String(request.lastPublishError || 'unknown').slice(0, 900)}\`\`\`\nAttempts: ${request.publishAttempts || 0}. The caster has **not** been notified yet.`, inline: false }
      : null,
    request.websiteSyncError && status === 'approved'
      ? { name: 'Website sync warning', value: String(request.websiteSyncError).slice(0, 500), inline: false }
      : null,
    request.postCastFormNote
      ? { name: 'Post-cast form (previous cast)', value: String(request.postCastFormNote).slice(0, 500), inline: false }
      : null,
    status === 'approved' && request.postCastReminderSentAt
      ? {
        name: 'Post-cast form',
        value: request.postCastFormWaivedAt
          ? `Marked received by <@${request.postCastFormWaivedBy || 'staff'}>`
          : request.postCastFormSubmittedAt
            ? `Received ${discordTimestamp(request.postCastFormSubmittedAt, 'f')}`
            : `⏳ Outstanding (reminder sent ${discordTimestamp(request.postCastReminderSentAt, 'R')})`,
        inline: false
      }
      : null
  ].filter(Boolean);
  return new EmbedBuilder()
    .setColor(colors[status] || EMBED_COLORS.admin)
    .setTitle(`Stream Request ${request.id} - ${request.matchup}`)
    .setDescription([
      STREAM_STATUS_LABELS[status] || `Status: **${status.toUpperCase()}**`,
      request.faceitLinkValid
        ? 'FACEIT matchroom verified. Schedule monitoring and grouped delivery are enabled.'
        : `⚠️ FACEIT LINK NOT VERIFIED: ${String(request.faceitValidationError || 'Unknown validation error').slice(0, 800)} This request cannot be grouped with similar requests or receive automatic schedule/connect updates.`,
      request.repeatSubmission ? `This requester has ${request.priorSubmissionCount} closed earlier request(s) for this match.` : null
    ].filter(Boolean).join('\n'))
    .addFields(fields)
    .setFooter({ text: `Request ${request.id}${request.sourceChannelId ? ` • from #${request.sourceChannelId}` : ''} • A request is not permission until staff approves it.` })
    .setTimestamp(new Date(request.updatedAt || request.createdAt || Date.now()));
}

function streamReviewComponents(request) {
  if (request.status === 'publish_failed') {
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`stream_review:${request.id}:retry`).setLabel('Retry website publish').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`stream_review:${request.id}:revoke`).setLabel('Revoke approval').setStyle(ButtonStyle.Danger)
    )];
  }
  if (request.status !== 'pending') return [];
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`stream_review:${request.id}:approve`)
      .setLabel(request.faceitLinkValid ? 'Approve' : 'Approve Manually')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`stream_review:${request.id}:deny`).setLabel('Deny').setStyle(ButtonStyle.Danger)
  )];
}

async function handleStreamReview(interaction) {
  if (!canManageStreamRequests(interaction.member)) {
    await interaction.reply({ content: 'Only authorized staff can review stream requests.', ephemeral: true });
    return;
  }
  const [, requestId, decision] = interaction.customId.split(':');
  if (decision === 'deny') {
    const current = await getStreamRequest(requestId);
    if (!current || current.status !== 'pending') {
      await reportStreamAlreadyDecided(interaction, current);
      return;
    }
    const modal = new ModalBuilder().setCustomId(`stream_deny_submit:${requestId}`).setTitle('Deny Stream Request');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Reason (shown to the caster)')
        .setPlaceholder('e.g. This match already has official coverage.')
        .setStyle(TextInputStyle.Paragraph)
        .setMinLength(5)
        .setMaxLength(400)
        .setRequired(true)
    ));
    await interaction.showModal(modal);
    return;
  }
  if (decision === 'retry') {
    await handleStreamRetryPublish(interaction, requestId);
    return;
  }
  if (decision === 'revoke') {
    await interaction.deferReply({ ephemeral: true });
    const revoked = await revokeStreamRequest(requestId, interaction.user.id, 'Approval revoked by staff');
    await interaction.editReply(revoked ? `Approval for request ${requestId} revoked; the caster has been notified.` : 'Only an approved or publish-failed request can be revoked.');
    return;
  }
  if (decision !== 'approve') {
    await interaction.reply({ content: 'Unknown review action.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const existing = await getStreamRequest(requestId);
  if (!existing || existing.status !== 'pending') {
    await reportStreamAlreadyDecided(interaction, existing);
    return;
  }
  // FACEIT is refreshed immediately before approval so staff never approve a finished match.
  if (existing.matchId && existing.faceitLinkValid) {
    const latestMatch = await faceit.getMatch(existing.matchId).catch(() => null);
    if (!latestMatch) {
      await interaction.editReply('FACEIT could not be reached to verify this match right now. Nothing was approved; try again in a few minutes.');
      return;
    }
    if (isTerminalFaceitStatus(latestMatch.status)) {
      await interaction.editReply(`This FACEIT match is already **${latestMatch.status}**, so the request cannot be approved.`);
      return;
    }
    const latestScheduleIso = getFaceitScheduledAtIso(latestMatch);
    await updateStreamRequest(requestId, {
      matchup: `${latestMatch.teamA} vs ${latestMatch.teamB}`,
      faceitStatus: latestMatch.status,
      faceitScheduledAtIso: latestScheduleIso,
      faceitLastCheckedAt: new Date().toISOString(),
      dateTimeIso: latestScheduleIso,
      dateTime: latestScheduleIso ? formatEasternDateTimeInput(latestScheduleIso) : 'Not scheduled on FACEIT yet'
    }, ['pending']);
  }
  // Atomic pending -> approving. A second staff member clicking at the same time loses the race.
  const claimed = await claimStreamApproval(requestId, interaction.user.id);
  if (!claimed) {
    await reportStreamAlreadyDecided(interaction, await getStreamRequest(requestId));
    return;
  }
  await refreshStreamRequestStaffMessage(claimed);
  await appendAuditLog({ type: 'stream_request_approved', actorId: interaction.user.id, matchId: claimed.matchId, requestId });
  await publishStreamApproval(claimed, interaction);
}

async function handleStreamRetryPublish(interaction, requestId) {
  await interaction.deferReply({ ephemeral: true });
  const claimed = await claimStreamRepublish(requestId, interaction.user.id);
  if (!claimed) {
    await reportStreamAlreadyDecided(interaction, await getStreamRequest(requestId));
    return;
  }
  await refreshStreamRequestStaffMessage(claimed);
  await appendAuditLog({ type: 'stream_request_publish_retry', actorId: interaction.user.id, matchId: claimed.matchId, requestId });
  await publishStreamApproval(claimed, interaction);
}

// Publishes an `approving` request to the website and finalises it as
// `approved` or `publish_failed`. The caster is only told on success.
async function publishStreamApproval(request, interaction) {
  const result = await websitePublisher.publish(request, { status: 'approved' })
    .catch((error) => ({ ok: false, websiteId: null, error: error?.message || String(error) }));
  const updated = await recordStreamPublishResult(request.id, result);
  if (!updated) {
    await interaction.editReply('State conflict while finishing the approval. Check the request card.');
    return;
  }
  await refreshStreamRequestStaffMessage(updated);
  if (updated.status === 'approved') {
    const notified = await announceStreamApproval(updated);
    const sheetWarning = await logStreamLinkToSheet(updated, interaction.user.id);
    await appendAuditLog({ type: 'stream_request_published', actorId: interaction.user.id, matchId: updated.matchId, requestId: updated.id, websiteId: updated.websiteId, publisher: websitePublisher.mode });
    await interaction.editReply([
      `✅ Request ${updated.id} approved${websitePublisher.mode === 'http' ? ' and published to the website.' : '. Website publishing is in log-only mode (WEBSITE_ENDPOINT is not set).'}`,
      notified ? null : '⚠️ Could not notify the caster. Check my permissions in their channel and whether their DMs are open.',
      sheetWarning ? `⚠️ ${sheetWarning}` : null
    ].filter(Boolean).join('\n'));
    return;
  }
  await appendAuditLog({ type: 'stream_request_publish_failed', actorId: interaction.user.id, matchId: updated.matchId, requestId: updated.id, error: updated.lastPublishError, attempts: updated.publishAttempts });
  await interaction.editReply([
    `⚠️ Request ${updated.id} is approved but the website call failed after ${updated.publishAttempts} attempt(s):`,
    `\`\`\`${String(updated.lastPublishError || 'unknown').slice(0, 500)}\`\`\``,
    'The caster has **not** been told yet. Fix the site/endpoint and press **Retry website publish** on the card.'
  ].join('\n'));
  await alertStreamStaff(`⚠️ Website publish failed for stream request ${updated.id} (${updated.matchup}). Retry from the request card above.`);
}

async function announceStreamApproval(request) {
  const scheduleIso = request.faceitScheduledAtIso || request.dateTimeIso;
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.accepted)
    .setTitle(`✅ Stream approved: ${request.matchup}`)
    .setDescription(`<@${request.requesterId}>'s cast is confirmed${websitePublisher.mode === 'http' ? ' and listed on the CROSSFIRE website' : ''}.`)
    .addFields([
      { name: 'When', value: formatScheduleForDiscord(scheduleIso, 'Not scheduled on FACEIT yet - the caster will be notified when a time is posted.'), inline: false },
      { name: `Watch${request.streamPlatform ? ` (${request.streamPlatform})` : ''}`, value: request.streamUrl, inline: false },
      { name: 'Caster on X', value: request.socialUrl, inline: false },
      request.faceitUrl ? { name: 'FACEIT Matchroom', value: request.faceitUrl, inline: false } : null
    ].filter(Boolean))
    .setFooter({ text: `Request ${request.id}` })
    .setTimestamp();
  const dmText = [
    `Your CROSSFIRE stream request ${request.id} was **approved** for **${request.matchup}**.`,
    !request.faceitLinkValid
      ? 'This was a manual approval because the FACEIT link could not be verified. Automatic schedule updates and connection delivery are unavailable for this request.'
      : null,
    scheduleIso
      ? `Scheduled for ${discordTimestamp(scheduleIso, 'F')} (${formatEasternDateTimeInput(scheduleIso)}).`
      : 'FACEIT has not scheduled this match yet. I will DM you when a date and time are posted.',
    request.faceitUrl ? `FACEIT matchroom: ${request.faceitUrl}` : null,
    config.streamGuidelinesUrl ? `Guidelines: ${config.streamGuidelinesUrl}` : config.streamGuidelinesText,
    'If something comes up and you can no longer cast, press **Withdraw from this cast** below (or use `/request cancel`) as early as you can so staff can find a replacement.'
  ].filter(Boolean).join('\n');
  const dmSent = await dmStreamRequester(request, { content: dmText, components: [streamCasterWithdrawRow(request)] });
  const posted = await postToStreamOrigin(request, { embeds: [embed], components: [streamCasterWithdrawRow(request)] });
  if (!dmSent && !posted) await alertStreamStaff(`Could not notify <@${request.requesterId}> that stream request ${request.id} was approved.`);
  return dmSent || posted;
}

async function announceStreamDenial(request) {
  const scheduleIso = request.faceitScheduledAtIso || request.dateTimeIso;
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.declined)
    .setTitle(`❌ Stream request denied: ${request.matchup}`)
    .setDescription(`<@${request.requesterId}>, your request was not approved.`)
    .addFields(
      { name: 'Reason', value: request.denialReason || 'No reason given', inline: false },
      { name: 'Match time', value: formatScheduleForDiscord(scheduleIso, request.dateTime || 'Not scheduled on FACEIT yet'), inline: false }
    )
    .setFooter({ text: `Request ${request.id} • You may submit a new request if the issue is fixed.` })
    .setTimestamp();
  const posted = await postToStreamOrigin(request, { embeds: [embed] });
  if (posted) return true;
  return notifyStreamRequester(request, `Your CROSSFIRE stream request ${request.id} for **${request.matchup}** was **denied**. Reason: ${request.denialReason}`);
}

// Posts a decision back to the channel the request came from, tagging the caster.
async function postToStreamOrigin(request, payload) {
  const channel = request.sourceChannelId ? await client.channels.fetch(request.sourceChannelId).catch(() => null) : null;
  if (!channel?.isTextBased?.()) return false;
  return channel.send({
    content: `<@${request.requesterId}>`,
    ...payload,
    allowedMentions: { users: [request.requesterId], roles: [], repliedUser: false }
  }).then(() => true).catch(() => false);
}

async function reportStreamAlreadyDecided(interaction, request) {
  let text = 'That request no longer exists.';
  if (request) {
    const label = STREAM_STATUS_LABELS[request.status] || request.status;
    text = `Request ${request.id} is already **${label}**${request.reviewedBy ? ` (decided by <@${request.reviewedBy}>)` : ''}.`;
    await refreshStreamRequestStaffMessage(request);
  }
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(text);
  } else {
    await interaction.reply({ content: text, ephemeral: true });
  }
}

async function revokeStreamRequest(requestId, actorId, reason) {
  const updated = await updateStreamRequest(requestId, {
    status: 'revoked',
    reviewedBy: actorId,
    revokedAt: new Date().toISOString(),
    denialReason: reason
  }, ['approved', 'publish_failed']);
  if (!updated) return null;
  await refreshStreamRequestStaffMessage(updated);
  await syncStreamRequestToWebsite(updated, 'revoked');
  const sheetWarning = await removeStreamLinkFromSheet(updated, actorId);
  if (sheetWarning) await alertStreamStaff(`⚠️ ${sheetWarning} (stream request ${updated.id}, ${updated.matchup})`);
  await notifyStreamRequester(updated, `Your CROSSFIRE stream approval ${updated.id} for **${updated.matchup}** was revoked. Reason: ${reason}`);
  await appendAuditLog({ type: 'stream_request_revoked', actorId, matchId: updated.matchId, requestId, reason });
  return updated;
}

async function handleStreamDenialModal(interaction) {
  if (!canManageStreamRequests(interaction.member)) {
    await interaction.reply({ content: 'Only authorized staff can review stream requests.', ephemeral: true });
    return;
  }
  const requestId = interaction.customId.split(':')[1];
  const reason = validateDenialReason(interaction.fields.getTextInputValue('reason'));
  if (!reason.valid) {
    await interaction.reply({ content: reason.error, ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const updated = await updateStreamRequest(requestId, {
    status: 'denied',
    reviewedBy: interaction.user.id,
    reviewedAt: new Date().toISOString(),
    denialReason: reason.value
  }, ['pending']);
  if (!updated) {
    await reportStreamAlreadyDecided(interaction, await getStreamRequest(requestId));
    return;
  }
  await refreshStreamRequestStaffMessage(updated);
  const notified = await announceStreamDenial(updated);
  await appendAuditLog({ type: 'stream_request_denied', actorId: interaction.user.id, matchId: updated.matchId, requestId, reason: reason.value });
  await interaction.editReply(`❌ Request ${updated.id} denied${notified ? '; the caster has been notified.' : '. ⚠️ Could not notify the caster; check my permissions in their channel.'}`);
}

// Best-effort status update for a request the website already knows about.
// Never changes the Discord-side status; failures are surfaced on the card and to staff.
async function syncStreamRequestToWebsite(request, status) {
  if (!request?.websitePublishedAt) return false;
  const result = await websitePublisher.publish(request, { status })
    .catch((error) => ({ ok: false, websiteId: null, error: error?.message || String(error) }));
  if (result.ok) {
    await updateStreamRequest(request.id, { websiteSyncError: null, websiteSyncedAt: new Date().toISOString() });
    return true;
  }
  const message = `Website ${status} update failed: ${result.error}`;
  await updateStreamRequest(request.id, { websiteSyncError: message });
  await appendAuditLog({ type: 'stream_website_sync_failed', matchId: request.matchId, requestId: request.id, status, error: result.error });
  await alertStreamStaff(`⚠️ ${message} (stream request ${request.id}, ${request.matchup}). The website may still list this stream.`);
  return false;
}

async function alertStreamStaff(text) {
  const channel = config.streamRequestChannelId
    ? await client.channels.fetch(config.streamRequestChannelId).catch(() => null)
    : null;
  if (!channel?.isTextBased?.()) {
    console.error('[Stream] staff alert not delivered (no review channel):', text);
    return false;
  }
  return channel.send({
    content: [getStaffMentions(channel.guild), text].filter(Boolean).join('\n'),
    allowedMentions: getAdminAllowedMentions(channel.guild)
  }).then(() => true).catch(() => false);
}

// Startup check: can the bot see and post in the stream channels it depends on?
async function auditStreamChannelPermissions() {
  const targets = [
    ['staff review', config.streamRequestChannelId],
    ...config.streamCommunityChannelIds.map((id) => ['community request', id])
  ].filter(([, id]) => id);
  if (!targets.length) {
    console.warn('Stream requests are disabled: STREAM_REQUEST_CHANNEL_ID is not set');
    return;
  }
  const problems = [];
  for (const [label, channelId] of targets) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.() || !channel.guild) {
      problems.push(`${label} channel ${channelId}: not found (wrong ID, or the bot is not in that server)`);
      continue;
    }
    const me = channel.guild.members.me || await channel.guild.members.fetchMe().catch(() => null);
    const permissions = me ? channel.permissionsFor(me) : null;
    const missing = [
      ['View Channel', PermissionFlagsBits.ViewChannel],
      ['Send Messages', PermissionFlagsBits.SendMessages],
      ['Embed Links', PermissionFlagsBits.EmbedLinks]
    ].filter(([, flag]) => !permissions?.has(flag)).map(([name]) => name);
    if (missing.length) problems.push(`${label} channel #${channel.name}: missing ${missing.join(', ')}`);
  }
  if (!problems.length) {
    console.log('Stream channel permission audit passed');
    return;
  }
  for (const problem of problems) console.error(`PERMISSION PROBLEM - ${problem}`);
  await alertStreamStaff(`🚨 Stream bot permission problems:\n${problems.map((problem) => `• ${problem}`).join('\n')}`);
}

async function recoverStreamRequestsOnStartup() {
  for (const request of await recoverInterruptedStreamPublishes()) {
    console.warn(`Stream request ${request.id} was mid-publish at shutdown; marked publish_failed`);
    await refreshStreamRequestStaffMessage(request);
    await alertStreamStaff(`⚠️ Stream request ${request.id} (${request.matchup}) was approved but the bot restarted before the website confirmed it. Use **Retry website publish** on its card.`);
  }
  await repostStreamRequestsAwaitingStaff();
}

// Requests saved while the staff channel was unreachable are posted once it is back.
async function repostStreamRequestsAwaitingStaff() {
  if (!config.streamRequestChannelId) return;
  for (const request of await listStreamRequestsAwaitingStaffPost()) {
    const pending = request.status === 'pending'
      ? request
      : await updateStreamRequest(request.id, { status: 'pending', denialReason: null }, ['submission_failed']);
    if (!pending) continue;
    try {
      await sendStreamRequestToStaff(pending);
      console.log(`Re-posted stream request ${pending.id} to the staff review channel`);
    } catch (error) {
      await updateStreamRequest(pending.id, { staffPostError: error.message }, ['pending']);
    }
  }
}

async function notifyStreamRequester(request, text) {
  const user = await client.users.fetch(request.requesterId).catch(() => null);
  if (user && await user.send(text).then(() => true).catch(() => false)) return true;
  const channel = request.sourceChannelId ? await client.channels.fetch(request.sourceChannelId).catch(() => null) : null;
  if (channel?.isTextBased?.()) {
    const delivered = await channel.send({
      content: `<@${request.requesterId}> ${text}`,
      allowedMentions: { users: [request.requesterId], roles: [], repliedUser: false }
    }).then(() => true).catch(() => false);
    if (delivered) return true;
  }
  const staff = config.streamRequestChannelId ? await client.channels.fetch(config.streamRequestChannelId).catch(() => null) : null;
  await staff?.send(`Could not DM <@${request.requesterId}> about stream request ${request.id}.`).catch(() => null);
  return false;
}

async function dmStreamRequester(request, payload) {
  const user = await client.users.fetch(request.requesterId).catch(() => null);
  return Boolean(user && await user.send(payload).then(() => true).catch(() => false));
}

function getFaceitScheduledAtIso(match) {
  const seconds = Number(match?.raw?.scheduled_at);
  if (Number.isFinite(seconds) && seconds > 0) return new Date(seconds * 1000).toISOString();
  const parsed = Date.parse(match?.scheduledAt || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

async function refreshStreamRequestStaffMessage(request) {
  if (!request?.staffChannelId || !request?.staffMessageId) return;
  const channel = await client.channels.fetch(request.staffChannelId).catch(() => null);
  const message = await channel?.messages.fetch(request.staffMessageId).catch(() => null);
  if (!message) return;
  await message.edit({
    embeds: [streamRequestEmbed(request)],
    components: streamReviewComponents(request)
  }).catch(() => null);
}

async function sendStreamDeliveryPrompt(matchId, force = false) {
  const channel = config.streamRequestChannelId
    ? await client.channels.fetch(config.streamRequestChannelId).catch(() => null)
    : null;
  if (!channel?.isTextBased?.()) return false;
  if (force) {
    await disableStreamDeliveryPrompts(await listStreamRequests({ matchId, status: 'approved' }));
  }
  const requests = await claimStreamDeliveryPrompt(matchId, force);
  if (!requests?.length) return false;
  const match = await faceit.getMatch(matchId).catch(() => null);
  const matchup = match ? `${match.teamA} vs ${match.teamB}` : requests[0].matchup;
  let message;
  try {
    message = await channel.send({
    content: getStaffMentions(channel.guild),
    embeds: [new EmbedBuilder()
      .setColor(EMBED_COLORS.warning)
      .setTitle('Caster Connection Needed')
      .setDescription(`**${matchup}** is scheduled now. Submit either the FACEIT CSTV connect command or the official CROSSFIRE Twitch link. It will be DMed only to approved casters for this match.`)
      .addFields({ name: 'FACEIT Matchroom', value: requests[0].faceitUrl || `Match ${matchId}` })
      .setTimestamp()],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`stream_delivery_open:cstv:${matchId}`).setLabel('Submit CSTV Connect').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`stream_delivery_open:twitch:${matchId}`).setLabel('Submit Twitch Link').setStyle(ButtonStyle.Secondary)
    )],
    allowedMentions: getAdminAllowedMentions(channel.guild)
    });
  } catch (error) {
    for (const request of requests) {
      await updateStreamRequest(request.id, { deliveryPromptSentAt: null, deliveryPromptMessageId: null }, ['approved']);
    }
    throw error;
  }
  for (const request of requests) {
    await updateStreamRequest(request.id, { deliveryPromptMessageId: message.id }, ['approved']);
  }
  return true;
}

async function handleStreamDeliveryOpen(interaction) {
  if (!canManageStreamRequests(interaction.member)) {
    await interaction.reply({ content: 'Only authorized staff can submit caster connection details.', ephemeral: true });
    return;
  }
  const [, type, matchId] = interaction.customId.split(':');
  const label = type === 'cstv' ? 'CSTV connect command' : 'CROSSFIRE Twitch link';
  const modal = new ModalBuilder()
    .setCustomId(`stream_delivery_submit:${type}:${matchId}`)
    .setTitle(type === 'cstv' ? 'Submit CSTV Connect' : 'Submit Twitch Link')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('delivery')
        .setLabel(label)
        .setPlaceholder(type === 'cstv' ? 'Example: connect 123.45.67.89:27020' : 'Example: https://twitch.tv/crossfire')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ));
  await interaction.showModal(modal);
}

async function handleStreamDeliverySubmit(interaction) {
  if (!canManageStreamRequests(interaction.member)) {
    await interaction.reply({ content: 'Only authorized staff can submit caster connection details.', ephemeral: true });
    return;
  }
  const [, type, matchId] = interaction.customId.split(':');
  const delivery = validateStreamDelivery(type, interaction.fields.getTextInputValue('delivery'));
  if (!delivery.valid) {
    await interaction.reply({ content: delivery.error, ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const result = await deliverStreamConnection(matchId, type, delivery.value, interaction.user.id);
  await interaction.message?.edit({ components: [] }).catch(() => null);
  await interaction.editReply(`Sent the ${type === 'cstv' ? 'CSTV connect' : 'Twitch link'} to ${result.delivered}/${result.casterCount} approved caster(s).`);
}

async function deliverStreamConnection(matchId, type, value, actorId) {
  const requests = await listStreamRequests({ matchId, status: 'approved' });
  let delivered = 0;
  const deliveryByCaster = new Map();
  for (const request of new Map(requests.map((entry) => [entry.requesterId, entry])).values()) {
    const label = type === 'cstv'
      ? 'FACEIT CSTV connect'
      : type === 'twitch' ? 'official CROSSFIRE stream' : 'connection details from Tournament Operations';
    const detail = type === 'cstv' ? `\`${value}\`` : value;
    const sent = await dmStreamRequester(request, `**${request.matchup}** is ready. ${label}:\n${detail}`);
    if (sent) delivered += 1;
    deliveryByCaster.set(request.requesterId, sent);
  }
  for (const request of requests) {
    const sent = deliveryByCaster.get(request.requesterId) || false;
    await updateStreamRequest(request.id, {
      deliveryType: type,
      deliverySentAt: new Date().toISOString(),
      deliverySentBy: actorId,
      deliveryStatus: sent ? 'delivered' : 'failed'
    }, ['approved']);
  }
  await appendAuditLog({ type: 'stream_connection_delivered', actorId, matchId, delivered, requestCount: requests.length });
  return { delivered, casterCount: deliveryByCaster.size, requests };
}

async function disableStreamDeliveryPrompts(requests) {
  const messageIds = [...new Set(requests.map((request) => request.deliveryPromptMessageId).filter(Boolean))];
  if (!messageIds.length || !config.streamRequestChannelId) return;
  const channel = await client.channels.fetch(config.streamRequestChannelId).catch(() => null);
  for (const messageId of messageIds) {
    const message = await channel?.messages.fetch(messageId).catch(() => null);
    await message?.edit({ components: [] }).catch(() => null);
  }
}

async function handleCancelStreamRequests(message, content) {
  if (!canManageStreamRequests(message.member)) {
    await message.reply('Only authorized staff can cancel caster requests.');
    return;
  }
  const target = content.replace(/^!cancelreq\b/i, '').trim();
  const parsed = parseFaceitMatchRoomLink(target);
  const mentionedId = message.mentions.users.first()?.id || (/^\d{15,25}$/.test(target) ? target : null);
  if (!parsed && !mentionedId) {
    await message.reply('Use `!cancelreq FACEIT_MATCHROOM_LINK` or `!cancelreq @caster`.');
    return;
  }
  const requests = await listStreamRequests();
  const matches = requests.filter((request) => {
    if (parsed) return request.matchId === parsed.matchId && STREAM_ACTIVE_STATUSES.includes(request.status);
    return request.requesterId === mentionedId && ['approved', 'publish_failed'].includes(request.status);
  });
  for (const request of matches) {
    const updated = await updateStreamRequest(request.id, {
      status: 'canceled',
      canceledBy: message.author.id,
      canceledAt: new Date().toISOString(),
      denialReason: 'Canceled by staff'
    }, STREAM_ACTIVE_STATUSES);
    if (!updated) continue;
    await refreshStreamRequestStaffMessage(updated);
    await syncStreamRequestToWebsite(updated, 'canceled');
    await notifyStreamRequester(updated, `Your CROSSFIRE stream request ${updated.id} for ${updated.matchup} was canceled by staff.`);
  }
  await appendAuditLog({ type: 'stream_requests_canceled', actorId: message.author.id, matchId: parsed?.matchId || null, requesterId: mentionedId, count: matches.length });
  await message.reply(`Canceled ${matches.length} matching request(s).`);
}

async function handleResendStreamDelivery(message, content) {
  if (!canManageStreamRequests(message.member)) {
    await message.reply('Only authorized staff can restart caster connection delivery.');
    return;
  }
  const parsed = parseFaceitMatchRoomLink(content.replace(/^!resendip\b/i, '').trim());
  if (!parsed) {
    await message.reply('Use `!resendip FACEIT_MATCHROOM_LINK`.');
    return;
  }
  const sent = await sendStreamDeliveryPrompt(parsed.matchId, true);
  await message.reply(sent ? 'Restarted the staff CSTV/Twitch prompt.' : 'No approved caster requests were found for that FACEIT matchroom.');
}

async function handleSendIp(message, content) {
  if (!canManageStreamRequests(message.member)) {
    await message.reply('Only authorized staff can send caster connection details.');
    return;
  }
  const input = content.replace(/^!sendip\b/i, '').trim();
  const separator = input.search(/\s/);
  const faceitUrl = separator === -1 ? input : input.slice(0, separator);
  const deliveryText = separator === -1 ? '' : input.slice(separator).trim();
  const parsed = parseFaceitMatchRoomLink(faceitUrl);
  const delivery = validateStreamDelivery('custom', deliveryText);
  if (!parsed || !delivery.valid) {
    await message.reply('Use `!sendip FACEIT_MATCHROOM_LINK MESSAGE`, for example `!sendip https://www.faceit.com/en/cs2/room/1-... connect 123.45.67.89:27020`.');
    return;
  }
  await message.delete().catch(() => null);
  const result = await deliverStreamConnection(parsed.matchId, 'custom', delivery.value, message.author.id);
  if (!result.requests.length) {
    const channel = message.channel;
    await channel.send('No approved caster requests were found for that FACEIT matchroom.').catch(() => null);
    return;
  }
  await disableStreamDeliveryPrompts(result.requests);
  await message.channel.send(`Sent the connection details to ${result.delivered}/${result.casterCount} approved caster(s).`).catch(() => null);
}

async function handleAdminStreams(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const action = interaction.options.getString('action', true);
  const requestId = interaction.options.getString('request_id');
  const reason = interaction.options.getString('reason') || '';
  if (action === 'pending' || action === 'approved' || action === 'publish_failed') {
    const statuses = action === 'pending' ? ['pending', 'approving'] : [action];
    const requests = (await listStreamRequests()).filter((request) => statuses.includes(request.status));
    const scheduleOf = (request) => discordTimestamp(request.faceitScheduledAtIso || request.dateTimeIso, 'f') || request.dateTime || 'unscheduled';
    await interaction.editReply(truncateDiscordMessage(requests.length
      ? requests.slice(0, 40).map((request) => `- \`${request.id}\` **${request.matchup}** | <@${request.requesterId}> | ${scheduleOf(request)} | ${request.status.replace('_', ' ')}`).join('\n')
      : `No ${action.replace('_', ' ')} stream requests.`));
    return;
  }
  const request = requestId ? await getStreamRequest(requestId) : null;
  if (!request) {
    await interaction.editReply('Provide a valid `request_id`.');
    return;
  }
  if (action === 'inspect') {
    await interaction.editReply({ embeds: [streamRequestEmbed(request)] });
    return;
  }
  if (action === 'retry') {
    if (request.status !== 'publish_failed') {
      await interaction.editReply(`Only a publish-failed request can be retried. Request ${request.id} is **${STREAM_STATUS_LABELS[request.status] || request.status}**.`);
      return;
    }
    const claimed = await claimStreamRepublish(requestId, interaction.user.id);
    if (!claimed) {
      await reportStreamAlreadyDecided(interaction, await getStreamRequest(requestId));
      return;
    }
    await refreshStreamRequestStaffMessage(claimed);
    await appendAuditLog({ type: 'stream_request_publish_retry', actorId: interaction.user.id, matchId: claimed.matchId, requestId });
    await publishStreamApproval(claimed, interaction);
    return;
  }
  if (action === 'cancel') {
    const updated = await updateStreamRequest(requestId, {
      status: 'canceled',
      canceledBy: interaction.user.id,
      canceledAt: new Date().toISOString(),
      denialReason: reason || 'Canceled by staff'
    }, STREAM_ACTIVE_STATUSES);
    await interaction.editReply(updated ? 'Request canceled and the caster will be notified.' : 'Only an active request can be canceled.');
    if (updated) {
      await refreshStreamRequestStaffMessage(updated);
      await syncStreamRequestToWebsite(updated, 'canceled');
      await appendAuditLog({ type: 'stream_request_canceled_by_staff', actorId: interaction.user.id, matchId: updated.matchId, requestId, reason: updated.denialReason });
      await notifyStreamRequester(updated, `Your CROSSFIRE stream request ${updated.id} was canceled by staff. Reason: ${updated.denialReason}`);
    }
    return;
  }
  if (action === 'revoke') {
    const updated = await revokeStreamRequest(requestId, interaction.user.id, reason || 'Approval revoked by staff');
    await interaction.editReply(updated ? 'Approval revoked and the caster will be notified.' : 'Only an approved or publish-failed request can be revoked.');
    return;
  }
  if (action === 'complete') {
    await sendPostCastReminder(request.matchId, interaction.user.id);
    await interaction.editReply('Marked completion and processed eligible post-cast reminders.');
    return;
  }
  if (action === 'form_received') {
    const now = new Date().toISOString();
    const updated = await updateStreamRequest(requestId, {
      postCastFormSubmittedAt: request.postCastFormSubmittedAt || now,
      postCastFormWaivedAt: now,
      postCastFormWaivedBy: interaction.user.id,
      postCastFormSource: 'staff',
      postCastFormNote: reason || request.postCastFormNote || null
    }, ['approved']);
    if (!updated) {
      await interaction.editReply('Only an approved (cast) request can have its post-cast form marked received.');
      return;
    }
    await refreshStreamRequestStaffMessage(updated);
    await appendAuditLog({ type: 'stream_post_cast_form_waived', actorId: interaction.user.id, matchId: updated.matchId, requestId, reason: reason || null });
    await interaction.editReply(`Post-cast form for ${requestId} (${updated.matchup}) marked received. <@${updated.requesterId}> can request again.`);
  }
}

async function sendPostCastReminder(matchId, actorId = null) {
  if (!matchId) return;
  const requests = await listStreamRequests({ matchId, status: 'approved' });
  for (const request of requests) {
    const claimed = await claimPostCastReminder(request.id);
    if (!claimed) continue;
    const sent = await notifyStreamRequester(claimed, [
      `Thanks for covering **${claimed.matchup}** for Crossfire! Please fill out the post-cast stats form (your request ID ${claimed.id} is already filled in):`,
      postCastFormLinkFor(claimed.id),
      config.postCastFormGate ? 'Your next stream request is blocked until this form is in.' : null
    ].filter(Boolean).join('\n'));
    await updateStreamRequest(claimed.id, {
      postCastReminderSentAt: new Date().toISOString(),
      postCastReminderDelivery: sent ? 'delivered' : 'failed',
      completedBy: actorId
    }, ['approved']);
  }
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
  const matches = (await faceit.getMatches().catch(() => [])).map(normalizeConfiguredMatch);
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

  const matches = (await faceit.getMatches().catch(() => [])).map(normalizeConfiguredMatch);
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
  if (topic) return false;

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
    content: 'Scheduling is command-only now. In the match room, use `!schedule November 2 8 PM ET`; teams confirm with `!accept`, while Tournament Ops can skip team confirmation but still require admin approval.',
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
  const acceptedProposal = await acceptScheduleProposal(proposal.id, acceptedBy);
  if (!acceptedProposal) {
    await saveSchedule(proposal.matchId, {
      scheduledAt: proposal.scheduledAt,
      scheduledAtIso: proposal.scheduledAtIso || null,
      timezone: proposal.timezone,
      proposedBy: proposal.proposedBy,
      acceptedBy,
      proposalId: proposal.id,
      kind: proposal.kind || 'schedule',
      overrideReason: proposal.overrideReason || null
    });
  }
  const faceitLine = adminActionLine(proposal);
  const scheduledMatch = {
    ...stored.match,
    status: stored.match.scheduledByDiscord ? stored.match.status : 'schedule_pending_admin',
    scheduledByDiscord: Boolean(stored.match.scheduledByDiscord),
    scheduledAt: stored.match.scheduledAt || null
  };
  await saveMatch(scheduledMatch, stored.discord);
  return faceitLine;
}

async function notifyAdmins(guild, stored, proposal, acceptedBy, faceitLine) {
  const channel = await getScheduleAdminChannel();
  const allowedMentions = getAdminAllowedMentions(guild);
  const adminEmbed = scheduleStatusEmbed({
    title: proposal.override
      ? (proposal.kind === 'reschedule'
          ? 'Action Needed: Approve Tournament Ops Reschedule'
          : 'Action Needed: Approve Tournament Ops Schedule')
      : (proposal.kind === 'reschedule'
          ? 'Action Needed: Approve Reschedule'
          : 'Action Needed: Schedule On FACEIT'),
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
  const pinnedMatch = pinned?.find((message) => isIntroMessage(message, faceitUrl, matchTitle))
    || pinned?.find((message) => isAnyMatchIntroMessage(message));
  if (pinnedMatch) return pinnedMatch;

  const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  return recent?.find((message) => isIntroMessage(message, faceitUrl, matchTitle))
    || recent?.find((message) => isAnyMatchIntroMessage(message))
    || null;
}

function isAnyMatchIntroMessage(message) {
  return message.author?.id === client.user?.id
    && String(message.content || '').toLowerCase().includes('how to schedule this match');
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
    roundInfo
      ? `Default match date/time: **${formatDefaultMatchDateTime(roundInfo)}**`
      : displayMatch.scheduledAt
        ? `Default match date/time: **${displayMatch.scheduledAt}**`
        : 'Default match date/time: **admins will announce after FACEIT publishes the schedule**',
    `Discord match chat: <#${channel.id}>`,
    faceitRoomLine(displayMatch),
    getFaceitScheduledTimeLine(displayMatch),
    '',
    '**How to schedule this match**',
    '1. One team member posts `!schedule 11/2/2026 8 PM ET`, `!schedule Tuesday 3 PM ET`, or `!schedule November 2 8:00 PM ET`.',
    '2. The bot detects the timezone, records the proposed time, and pings the other team role.',
    '3. A member from the other team posts `!accept` to confirm or `!decline` to reject.',
    `4. After \`!accept\`, ${adminNotificationLine}`,
    'Tournament Ops can use `!schedule November 2 8 PM ET` without team confirmation, but an admin must still approve it.',
    '',
    '**Other commands**',
    '`!propose November 2 8:00 PM ET` - same as `!schedule`',
    '`!reschedule November 2 9:00 PM ET` - team member requests a new time',
    'Schedules and reschedules must stay inside this match window. Reschedules within 24 hours of match time require admin override.',
    isGroupStageMatch(displayMatch)
      ? scheduleWindow
        ? `Group Stage note: teams may schedule by mutual agreement inside ${formatScheduleWindow(scheduleWindow)}.`
        : 'Season 7 Group Stage note: the scheduling window is not configured yet; admins must verify proposed times until the dates are announced.'
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
  if (roundInfo.defaultDateTime) return roundInfo.defaultDateTime;
  if (roundInfo.defaultDate) return `${roundInfo.defaultDate} at 8:00 PM ET`;
  return 'admins will announce after FACEIT publishes the schedule';
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
  const configuredWindow = getConfiguredRoundWindow(match);
  if (configuredWindow) {
    return {
      name: match.categoryName || match.round,
      ...configuredWindow,
      defaultDateTime: match.scheduledAt || null
    };
  }

  if (isGroupStageMatch(match)) {
    const groupStageRound = getGroupStageRoundNumber(match);
    if (groupStageRound === 1) return seasonWindow('Round 1');
    if (groupStageRound === 2) return seasonWindow('Round 2');
    if (groupStageRound === 3) return seasonWindow('Round 3');
    return seasonWindow('Group Stage');
  }

  if (!isLegacySeason6Match(match)) return null;

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

function isLegacySeason6Match(match) {
  return [SEASON6_GROUP_STAGE_ID, SEASON6_PLAYOFF_ID].includes(match?.source?.id);
}

function getConfiguredRoundWindow(match) {
  const keys = [match?.round, match?.categoryName]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  for (const key of keys) {
    if (config.roundWindows[key]) return config.roundWindows[key];
  }
  return null;
}

function configuredFaceitSourceSummary() {
  return config.faceitSources.map((source) => `**${source.name}** (${source.id})`).join(', ');
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
  const beforeDecision = proposalId ? await getScheduleProposal(proposalId) : null;
  if (beforeDecision?.adminApproved || beforeDecision?.adminDenied) {
    await interaction.editReply(`This schedule request was already ${beforeDecision.adminApproved ? 'approved' : 'denied'}.`);
    return;
  }
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
    let faceitNote = '';
    if (stored && proposal) {
      try {
        const result = await scheduleFaceitMatch(
          config,
          proposal.matchId,
          proposal.scheduledAtIso || proposal.scheduledAt,
          proposal.timezone
        );
        faceitNote = result.skipped ? ' FACEIT still needs to be updated manually.' : ' FACEIT was updated.';
      } catch (error) {
        faceitNote = ` FACEIT update failed: ${error?.message || error}`;
      }
    }
    let renameResult = null;
    if (matchChannel && stored) {
      renameResult = await markMatchChannelScheduled(matchChannel, stored, proposal);
      await upsertMatchIntroMessage(matchChannel, {
        ...stored.match,
        status: 'discord_scheduled',
        scheduledByDiscord: true,
        scheduledAt: proposal?.scheduledAt || stored.match.scheduledAt
      });
    }
    await appendAuditLog({
      type: 'schedule_approved',
      matchId: stored?.match?.id || proposal?.matchId,
      actorId: interaction.user.id,
      oldTime: proposal?.previousScheduledAt || (stored ? currentScheduleText(stored) : null),
      newTime: proposal?.scheduledAt || null,
      reason: proposal?.overrideReason || null
    });
    await runOperationsTick().catch((error) => console.error('Veto reminder update failed:', error));
    await interaction.message.react('✅').catch(() => null);
    const missingProposalNote = proposal ? '' : ' I could not find the saved schedule request, so I used the admin message/match channel fallback.';
    const missingChannelNote = matchChannel ? '' : ' I could not find the match channel to mark yellow.';
    const renameFailureNote = renameResult?.error
      ? ` Discord blocked the channel rename: ${renameResult.error.message}`
      : '';
    const sheetWarning = stored
      ? await logScheduleToSheet({ stored, proposal, approvedBy: interaction.user.id, acceptedBy: proposal?.acceptedBy || null })
      : null;
    const sheetNote = sheetWarning ? ` ${sheetWarning}` : '';
    await interaction.editReply(`Approved and reacted with a checkmark.${missingProposalNote}${missingChannelNote}${renameFailureNote}${faceitNote}${sheetNote}`);
  } else {
    if (matchChannel && stored && proposal) {
      await saveMatch({
        ...stored.match,
        status: proposal.previousMatchStatus || 'unknown',
        scheduledAt: proposal.previousScheduledAt || null,
        scheduledByDiscord: Boolean(proposal.previousScheduledByDiscord)
      }, stored.discord);
    }
    await appendAuditLog({ type: 'schedule_denied', matchId: stored?.match?.id || proposal?.matchId, actorId: interaction.user.id });
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

// Sends a confirmed schedule to the Google Sheet. Never throws: a sheet failure must not
// undo a Discord approval. Returns a short warning string for staff when something went wrong.
async function logScheduleToSheet({ stored, proposal, approvedBy = null, acceptedBy = null, kind = null }) {
  if (!stored?.match) return null;
  const row = buildScheduleSheetRow({ stored, proposal, details: getMatchDisplayDetails(stored.match), approvedBy, acceptedBy, kind });
  try {
    const result = await scheduleSheet.append(row);
    if (result.ok) {
      if (!result.skipped) {
        console.log(`Schedule sheet ${result.updated ? 'updated' : 'added'} row ${result.row ?? '?'} for ${row.team1} vs ${row.team2}.`);
      }
      await appendAuditLog({
        type: 'schedule_sheet_logged',
        matchId: row.matchId || null,
        actorId: approvedBy || acceptedBy || null,
        skipped: Boolean(result.skipped),
        updated: Boolean(result.updated)
      }).catch(() => null);
      return null;
    }
    console.error(`Schedule sheet write failed for ${row.team1} vs ${row.team2}: ${result.error}`);
    await appendAuditLog({
      type: 'schedule_sheet_failed',
      matchId: row.matchId || null,
      actorId: approvedBy || acceptedBy || null,
      error: result.error
    }).catch(() => null);
    return `The Google Sheet was not updated: ${result.error}`;
  } catch (error) {
    console.error('Schedule sheet write crashed:', error);
    return `The Google Sheet was not updated: ${error?.message || error}`;
  }
}

// Puts an approved caster's stream URL on the match's row in the Google Sheet ("Stream Link/s").
// Never throws; returns a short warning for staff when the sheet could not be updated.
async function logStreamLinkToSheet(request, approvedBy = null) {
  if (!request?.streamUrl) return null;
  if (!parseFaceitMatchRoomLink(request.faceitUrl)) {
    return 'The Google Sheet was not updated: this request has no valid FACEIT matchroom link to find the match row. Add the stream link to the Game Schedules tab by hand.';
  }
  const row = buildStreamLinkSheetRow(request, { approvedBy });
  try {
    const result = await scheduleSheet.addStreamLink(row);
    if (result.ok) {
      if (!result.skipped) {
        console.log(`Schedule sheet: stream link ${result.duplicate ? 'already on' : 'added to'} row ${result.row ?? '?'} for ${request.matchup}.`);
      }
      await appendAuditLog({
        type: 'stream_link_sheet_logged',
        matchId: request.matchId || null,
        requestId: request.id,
        actorId: approvedBy,
        skipped: Boolean(result.skipped),
        duplicate: Boolean(result.duplicate)
      }).catch(() => null);
      return null;
    }
    console.error(`Schedule sheet stream link write failed for ${request.matchup}: ${result.error}`);
    await appendAuditLog({
      type: 'stream_link_sheet_failed',
      matchId: request.matchId || null,
      requestId: request.id,
      actorId: approvedBy,
      error: result.error
    }).catch(() => null);
    return `The Google Sheet was not updated with the stream link: ${result.error}`;
  } catch (error) {
    console.error('Schedule sheet stream link write crashed:', error);
    return `The Google Sheet was not updated with the stream link: ${error?.message || error}`;
  }
}

// Takes a withdrawn or revoked caster's link back off the match's row. Never throws.
async function removeStreamLinkFromSheet(request, actorId = null) {
  if (!request?.streamUrl || !parseFaceitMatchRoomLink(request.faceitUrl)) return null;
  const row = buildStreamLinkSheetRow(request, { approvedBy: actorId });
  try {
    const result = await scheduleSheet.removeStreamLink(row);
    if (result.ok) {
      if (!result.skipped) {
        console.log(`Schedule sheet: stream link ${result.removed ? 'removed from' : 'was not on'} row ${result.row || '?'} for ${request.matchup}.`);
      }
      await appendAuditLog({ type: 'stream_link_sheet_removed', matchId: request.matchId || null, requestId: request.id, actorId, skipped: Boolean(result.skipped), removed: Boolean(result.removed) }).catch(() => null);
      return null;
    }
    console.error(`Schedule sheet stream link removal failed for ${request.matchup}: ${result.error}`);
    await appendAuditLog({ type: 'stream_link_sheet_failed', matchId: request.matchId || null, requestId: request.id, actorId, error: result.error, action: 'remove' }).catch(() => null);
    return `The stream link is still on the Google Sheet: ${result.error}`;
  } catch (error) {
    console.error('Schedule sheet stream link removal crashed:', error);
    return `The stream link is still on the Google Sheet: ${error?.message || error}`;
  }
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
  return isAuthorizedStaffMember(member, config);
}

function canManageStreamRequests(member) {
  if (isAdminStaff(member)) return true;
  if (!member || member.guild?.id !== config.streamStaffGuildId) return false;
  return config.streamStaffRoleIds.some((roleId) => member.roles?.cache?.has(roleId));
}

function canUseBotAdminCommand(member) {
  return isAuthorizedStaffMember(member, config);
}

function hasScheduleOverride(member) {
  return isAuthorizedStaffMember(member, config) ||
    config.scheduleOverrideRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

async function handleAdminVeto(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const action = interaction.options.getString('action', true);
  const channel = interaction.options.getChannel('match_room') || interaction.channel;
  const stored = channel?.id ? await getStoredMatchForChannel(channel) : null;
  if (!stored) {
    await interaction.editReply('Select or run this inside a linked match room.');
    return;
  }

  if (action === 'inspect') {
    const veto = await getVeto(stored.match.id);
    await interaction.editReply(veto ? formatVetoStatus(veto) : 'No veto exists for this match.');
    return;
  }
  if (action === 'cancel') {
    const existing = await getVeto(stored.match.id);
    await saveVeto({ ...(existing || { matchId: stored.match.id }), status: 'canceled', canceledBy: interaction.user.id, canceledAt: new Date().toISOString() }, existing?.version ?? null);
    await appendAuditLog({ type: 'veto_cancel', matchId: stored.match.id, actorId: interaction.user.id });
    await interaction.editReply('Veto canceled. Automatic recovery will not restart it unless an admin resets it.');
    return;
  }
  if (action === 'seeds') {
    const teamASeed = interaction.options.getInteger('team_a_seed');
    const teamBSeed = interaction.options.getInteger('team_b_seed');
    const advantageTeam = interaction.options.getString('advantage_team');
    if (!teamASeed || !teamBSeed || teamASeed === teamBSeed) {
      await interaction.editReply('Provide two different positive seeds. Lower number means higher seed.');
      return;
    }
    const existing = await getVeto(stored.match.id);
    await saveVeto({
      ...(existing || {}),
      matchId: stored.match.id,
      teamA: stored.match.teamA,
      teamB: stored.match.teamB,
      teamASeed,
      teamBSeed,
      advantageTeam: advantageTeam || existing?.advantageTeam || null,
      seedSource: 'admin override',
      status: existing?.status || 'configured',
      seedConfiguredBy: interaction.user.id,
      seedConfiguredAt: new Date().toISOString()
    }, existing?.version ?? null);
    await appendAuditLog({ type: 'veto_seed_override', matchId: stored.match.id, actorId: interaction.user.id, teamASeed, teamBSeed });
    await interaction.editReply(`Persistent seed override saved: ${stored.match.teamA} #${teamASeed}, ${stored.match.teamB} #${teamBSeed}.${advantageTeam ? ` Grand Final advantage: ${advantageTeam === 'teamA' ? stored.match.teamA : stored.match.teamB}.` : ''}`);
    return;
  }
  if (action === 'reset') {
    const existing = await getVeto(stored.match.id);
    if (existing) await saveVeto({ ...existing, status: 'reset', resetBy: interaction.user.id }, existing.version);
  }
  await startVetoForStoredMatch(stored, channel, interaction.user.id, true);
  await interaction.editReply(`Veto started in <#${channel.id}>.`);
}

async function startVetoForStoredMatch(stored, channel, actorId = null, force = false) {
  if (!isPlayoffMatch(stored.match)) throw new Error('Automatic vetoes are only enabled for explicitly configured playoff sources.');
  const existing = await getVeto(stored.match.id);
  if (!force && existing && ['choosing_first_action', 'active', 'complete', 'canceled'].includes(existing.status)) return existing;
  const format = normalizeRoundCategory(stored.match.round).includes('grand final') ? 'bo5_advantage' : 'bo3';
  const configuredAdvantage = normalizeTeamKey(config.vetoAdvantageTeam || '');
  const configuredAdvantageTeam = configuredAdvantage && configuredAdvantage === normalizeTeamKey(stored.match.teamA)
    ? 'teamA'
    : configuredAdvantage && configuredAdvantage === normalizeTeamKey(stored.match.teamB)
      ? 'teamB'
      : null;
  const seeds = {
    teamA: existing?.teamASeed || config.vetoSeeds.get(normalizeTeamKey(stored.match.teamA)),
    teamB: existing?.teamBSeed || config.vetoSeeds.get(normalizeTeamKey(stored.match.teamB)),
    source: existing?.seedSource || 'configured tournament seed table'
  };
  const veto = createVeto({
    match: stored.match,
    mapPool: config.vetoMapPool,
    seeds,
    format,
    advantageTeam: existing?.advantageTeam || configuredAdvantageTeam,
    captainOnly: config.vetoCaptainOnly,
    sidePolicy: config.vetoSidePolicy
  });
  const saved = await saveVeto({ ...veto, channelId: channel.id, startedBy: actorId, startedAt: new Date().toISOString() }, existing?.version ?? null);
  const message = await channel.send(vetoMessagePayload(saved, stored));
  const updated = await saveVeto({ ...saved, messageId: message.id }, saved.version);
  await appendAuditLog({ type: 'veto_start', matchId: stored.match.id, actorId, format, seedSource: seeds.source });
  return updated;
}

async function handleVetoFirstChoice(interaction) {
  const [, matchId, versionText, choice] = interaction.customId.split(':');
  const veto = await getVeto(matchId);
  if (!veto || Number(versionText) !== Number(veto.version)) {
    await interaction.reply({ content: 'That veto button is stale. Use the newest veto message.', ephemeral: true });
    return;
  }
  const stored = await getStoredMatch(matchId);
  const actorTeam = await getVetoActorTeam(interaction.member, stored);
  await assertVetoActorEligible(interaction.member, stored, veto, actorTeam);
  const next = chooseFirstAction(veto, actorTeam, choice);
  const saved = await saveVeto(next, veto.version);
  await interaction.update(vetoMessagePayload(saved, stored));
}

async function handleVetoMapChoice(interaction) {
  const [, matchId, versionText, mapIndexText] = interaction.customId.split(':');
  const veto = await getVeto(matchId);
  if (!veto || Number(versionText) !== Number(veto.version)) {
    await interaction.reply({ content: 'That veto button is stale. Use the newest veto message.', ephemeral: true });
    return;
  }
  const stored = await getStoredMatch(matchId);
  const actorTeam = await getVetoActorTeam(interaction.member, stored);
  await assertVetoActorEligible(interaction.member, stored, veto, actorTeam);
  const mapName = veto.mapPool[Number(mapIndexText)];
  const next = applyVetoAction(veto, actorTeam, mapName);
  const saved = await saveVeto(next, veto.version);
  await interaction.update(vetoMessagePayload(saved, stored));
  if (saved.status === 'complete') await notifyStaffVetoComplete(saved, stored);
}

async function getVetoActorTeam(member, stored) {
  if (!stored || !member) return null;
  if (stored.discord?.teamARoleId && member.roles.cache.has(stored.discord.teamARoleId)) return 'teamA';
  if (stored.discord?.teamBRoleId && member.roles.cache.has(stored.discord.teamBRoleId)) return 'teamB';
  return null;
}

async function assertVetoActorEligible(member, stored, veto, actorTeam) {
  if (!actorTeam) throw new Error('You are not mapped to either team in this match.');
  if (!veto.captainOnly) return;
  const mappings = await listTeamMappings(teamMappingScope());
  const teamName = actorTeam === 'teamA' ? stored.match.teamA : stored.match.teamB;
  const mapping = mappings.find((candidate) => [candidate.teamName, ...(candidate.aliases || [])]
    .some((value) => normalizeTeamKey(value) === normalizeTeamKey(teamName)));
  if (!mapping?.captainDiscordIds?.includes(member.id)) throw new Error('Only the mapped captain for your team may act in this veto.');
}

function vetoMessagePayload(veto, stored) {
  const higherName = veto.higherSeedTeam === 'teamA' ? veto.teamA : veto.teamB;
  const currentName = veto.currentTeam === 'teamA' ? veto.teamA : veto.teamB;
  const actionLines = veto.actions.length
    ? veto.actions.map((entry) => `${entry.index}. **${entry.team === 'teamA' ? veto.teamA : veto.teamB}** ${entry.action} ${entry.map}`).join('\n')
    : 'No map actions yet.';
  const final = veto.final
    ? [
        `Playable maps: **${veto.final.playableMaps.join(', ')}**`,
        veto.final.awardedMap ? `Awarded map (not played): **${veto.final.awardedMap}**` : `Decider: **${veto.final.decider}**`,
        `Starting score: **${veto.final.startingScore}**`
      ].join('\n')
    : null;
  const embed = new EmbedBuilder()
    .setColor(veto.status === 'complete' ? EMBED_COLORS.accepted : EMBED_COLORS.admin)
    .setTitle(veto.status === 'complete' ? 'Discord Veto Complete' : 'CROSSFIRE Playoff Veto')
    .setDescription(`**${veto.teamA} vs ${veto.teamB}**`)
    .addFields(
      { name: 'Map Pool Snapshot', value: veto.mapPool.join(', ') },
      { name: 'Seeds', value: `${veto.teamA}: #${veto.teamASeed}\n${veto.teamB}: #${veto.teamBSeed}\nSource: ${veto.seedSource}` },
      { name: 'Actions', value: actionLines },
      final ? { name: 'Final Result', value: final } : { name: 'Current Turn', value: veto.status === 'choosing_first_action' ? `${higherName} chooses who takes the first veto action.` : `${currentName}: **${expectedVetoAction(veto)}** a map.` },
      { name: 'Side Policy', value: veto.sidePolicy },
      { name: 'FACEIT', value: stored.match.faceitUrl || 'Not linked' }
    )
    .setFooter({ text: 'Discord veto only. Staff must enter the result into FACEIT.' });
  const components = [];
  if (veto.status === 'choosing_first_action') {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`veto_first:${veto.matchId}:${veto.version}:self`).setLabel('Our team acts first').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`veto_first:${veto.matchId}:${veto.version}:opponent`).setLabel('Opponent acts first').setStyle(ButtonStyle.Secondary)
    ));
  } else if (veto.status === 'active') {
    const available = veto.mapPool.map((map, index) => ({ map, index })).filter(({ map }) => veto.availableMaps.includes(map));
    for (let index = 0; index < available.length; index += 5) {
      components.push(new ActionRowBuilder().addComponents(...available.slice(index, index + 5).map(({ map, index: mapIndex }) =>
        new ButtonBuilder().setCustomId(`veto_map:${veto.matchId}:${veto.version}:${mapIndex}`).setLabel(map).setStyle(ButtonStyle.Primary)
      )));
    }
  }
  return { embeds: [embed], components };
}

function formatVetoStatus(veto) {
  return truncateDiscordMessage([
    `**${veto.teamA} vs ${veto.teamB}**`,
    `Status: ${veto.status}`,
    `Format: ${veto.format}`,
    `Map pool: ${(veto.mapPool || []).join(', ')}`,
    `Turn: ${veto.currentTeam || 'none'} ${expectedVetoAction(veto) || ''}`,
    ...(veto.actions || []).map((entry) => `${entry.index}. ${entry.team} ${entry.action} ${entry.map}`)
  ].join('\n'));
}

async function notifyStaffVetoComplete(veto, stored) {
  const channelId = config.vetoStaffChannelId;
  const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
  if (!channel?.isTextBased?.()) return;
  await channel.send({ embeds: vetoMessagePayload(veto, stored).embeds });
}

function validateScheduleRequest(stored, proposedText, kind, parsedDate = null) {
  // Only compare dates produced by the strict schedule parser. Date.parse()
  // assigns surprising legacy years to inputs such as "November 6 9:00 EST".
  const proposedDate = parsedDate;
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

  if (!window && isGroupStageMatch(stored.match)) {
    result.warning = 'Season 7 round windows are not configured yet. Admins must verify this proposed time before approval.';
  }

  return result;
}

function getScheduleWindowForMatch(match) {
  if (isGroupStageMatch(match)) {
    const groupStage = config.roundWindows['group stage'] || seasonWindow('Group Stage');
    if (!groupStage) return null;

    return {
      start: groupStage.start,
      end: groupStage.end,
      label: 'Group Stage scheduling window'
    };
  }

  const configuredWindow = getConfiguredRoundWindow(match) ||
    config.roundWindows[String(canonicalPlayoffRoundName(match.round || match.categoryName)).toLowerCase()];
  if (configuredWindow) {
    return {
      ...configuredWindow,
      label: 'Scheduling window'
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
  const clock = parseScheduleClock(cleaned);
  if (!clock) return null;

  const zone = detectScheduleTimezone(cleaned);
  const dateParts = parseScheduleDateParts(cleaned, zone.timeZone);
  if (!dateParts) return null;

  const { hour, minute } = clock;

  const date = zonedTimeToUtc(
    dateParts.year,
    dateParts.month,
    dateParts.day,
    hour,
    minute,
    zone.timeZone
  );
  if (!date || Number.isNaN(date.getTime())) return null;
  const resolved = dateTimePartsInTimeZone(date, zone.timeZone);
  if (
    resolved.year !== dateParts.year
    || resolved.month !== dateParts.month
    || resolved.day !== dateParts.day
    || resolved.hour !== hour
    || resolved.minute !== minute
  ) return null;

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

async function runOperationsTick() {
  const now = Date.now();
  await runStreamOperationsTick(now);
  const schedules = await listSchedules();
  for (const schedule of schedules) {
    if (!schedule.adminApproved) continue;
    const startMs = Date.parse(schedule.scheduledAtIso || schedule.scheduledAt);
    if (!Number.isFinite(startMs) || startMs <= now) continue;
    if (startMs - now > 60 * 60 * 1000) continue;
    const stored = await getStoredMatch(schedule.matchId);
    if (!stored || !isPlayoffMatch(stored.match)) continue;
    const status = String(stored.match.status || '').toLowerCase();
    if (/(finished|done|completed|cancel)/.test(status)) continue;
    const existing = await getVeto(stored.match.id);
    if (existing && ['choosing_first_action', 'active', 'complete', 'canceled'].includes(existing.status)) continue;
    const channel = stored.discord?.channelId ? await client.channels.fetch(stored.discord.channelId).catch(() => null) : null;
    if (!channel?.isTextBased?.()) continue;
    try {
      await startVetoForStoredMatch(stored, channel);
    } catch (error) {
      if (existing?.status === 'blocked' && existing.reason === error.message) continue;
      await saveVeto({
        ...(existing || {}),
        matchId: stored.match.id,
        teamA: stored.match.teamA,
        teamB: stored.match.teamB,
        status: 'blocked',
        reason: error.message,
        scheduledAtIso: schedule.scheduledAtIso || null
      }, existing?.version ?? null);
      await channel.send({
        embeds: [new EmbedBuilder()
          .setColor(EMBED_COLORS.warning)
          .setTitle('Veto Needs Staff Configuration')
          .setDescription(error.message)
          .setFooter({ text: 'No seed or map-pool values were guessed. Staff can configure them and run /cf veto action:start.' })]
      });
    }
  }
}

async function runStreamOperationsTick(now = Date.now()) {
  await repostStreamRequestsAwaitingStaff().catch((error) => console.error('Stream request re-post failed:', error));
  const active = (await listStreamRequests()).filter((request) =>
    request.faceitLinkValid && request.matchId && !request.terminalNotifiedAt && STREAM_ACTIVE_STATUSES.includes(request.status)
  );
  const byMatch = new Map();
  for (const request of active) {
    if (!byMatch.has(request.matchId)) byMatch.set(request.matchId, []);
    byMatch.get(request.matchId).push(request);
  }
  const intervalMs = config.streamScheduleCheckMinutes * 60 * 1000;
  for (const [matchId, requests] of byMatch) {
    const lastChecked = Math.max(...requests.map((request) => Date.parse(request.faceitLastCheckedAt || '') || 0));
    let currentRequests = requests;
    if (now - lastChecked >= intervalMs) {
      try {
        const match = await faceit.getMatch(matchId);
        const nextIso = getFaceitScheduledAtIso(match);
        const previousIso = requests.find((request) => request.faceitScheduledAtIso)?.faceitScheduledAtIso || null;
        const scheduleChange = classifyFaceitScheduleChange(previousIso, nextIso);
        const scheduleUpdated = scheduleChange !== 'unchanged';
        const nextLabel = nextIso ? formatEasternDateTimeInput(nextIso) : null;
        if (scheduleUpdated) await disableStreamDeliveryPrompts(requests);
        currentRequests = [];
        for (const request of requests) {
          const updated = await updateStreamRequest(request.id, {
            faceitLastCheckedAt: new Date(now).toISOString(),
            faceitScheduledAtIso: nextIso,
            faceitStatus: match.status,
            faceitCheckError: null,
            ...(scheduleUpdated ? { deliveryPromptSentAt: null, deliveryPromptMessageId: null } : {}),
            ...(nextIso
              ? { dateTimeIso: nextIso, dateTime: nextLabel }
              : scheduleChange === 'unscheduled'
                ? { dateTimeIso: null, dateTime: 'Not scheduled on FACEIT yet' }
                : {})
          }, STREAM_ACTIVE_STATUSES);
          if (updated) {
            currentRequests.push(updated);
            await refreshStreamRequestStaffMessage(updated);
            // Keep the website's listing in step with FACEIT for already-published streams.
            if (scheduleUpdated && updated.status === 'approved') await syncStreamRequestToWebsite(updated, 'approved');
          }
        }
        if (scheduleUpdated) {
          const staffChannel = config.streamRequestChannelId
            ? await client.channels.fetch(config.streamRequestChannelId).catch(() => null)
            : null;
          await staffChannel?.send({
            content: getStaffMentions(staffChannel.guild),
            embeds: [new EmbedBuilder()
              .setColor(EMBED_COLORS.warning)
              .setTitle(scheduleChange === 'scheduled' ? 'FACEIT Stream Match Scheduled' : scheduleChange === 'unscheduled' ? 'FACEIT Stream Schedule Removed' : 'FACEIT Stream Schedule Changed')
              .setDescription(scheduleChange === 'scheduled'
                ? `**${currentRequests[0]?.matchup || matchId}** is now scheduled for **${nextLabel}**.`
                : scheduleChange === 'unscheduled'
                  ? `FACEIT removed the scheduled time for **${currentRequests[0]?.matchup || matchId}**. Caster delivery is paused until a new time is posted.`
                  : `**${currentRequests[0]?.matchup || matchId}** moved from **${formatEasternDateTimeInput(previousIso)}** to **${nextLabel}**.`)
              .addFields({ name: 'FACEIT Matchroom', value: currentRequests[0]?.faceitUrl || match.faceitUrl })
              .setTimestamp()],
            allowedMentions: getAdminAllowedMentions(staffChannel.guild)
          }).catch(() => null);
          const approvedRequests = currentRequests.filter((request) => request.status === 'approved');
          const byCaster = new Map(approvedRequests.map((request) => [request.requesterId, request]));
          const failedCasterIds = [];
          for (const request of byCaster.values()) {
            const message = scheduleChange === 'scheduled'
              ? `FACEIT scheduled **${request.matchup}** for **${nextLabel}**. Your approved stream request has been updated automatically.`
              : scheduleChange === 'unscheduled'
                ? `FACEIT removed the scheduled time for **${request.matchup}**. I will notify you when a new time is posted.`
                : `FACEIT changed **${request.matchup}** from **${formatEasternDateTimeInput(previousIso)}** to **${nextLabel}**. Your approved stream request has been updated automatically.`;
            const sent = await dmStreamRequester(request, message);
            if (!sent) failedCasterIds.push(request.requesterId);
          }
          if (failedCasterIds.length) {
            await staffChannel?.send(`Could not DM schedule changes to: ${failedCasterIds.map((id) => `<@${id}>`).join(', ')}`).catch(() => null);
          }
          await appendAuditLog({
            type: scheduleChange === 'scheduled' ? 'stream_match_scheduled' : scheduleChange === 'unscheduled' ? 'stream_schedule_removed' : 'stream_schedule_changed',
            matchId,
            previousIso,
            nextIso,
            requestCount: currentRequests.length
          });
        }
      } catch (error) {
        for (const request of requests) {
          await updateStreamRequest(request.id, {
            faceitLastCheckedAt: new Date(now).toISOString(),
            faceitCheckError: error.message
          }, STREAM_ACTIVE_STATUSES);
        }
      }
    }
    const terminal = currentRequests.length > 0 && currentRequests.every((request) => isTerminalFaceitStatus(request.faceitStatus));
    if (terminal) {
      await disableStreamDeliveryPrompts(currentRequests);
      const terminalAt = new Date(now).toISOString();
      const canceled = currentRequests.every((request) => isCanceledFaceitStatus(request.faceitStatus));
      for (const request of currentRequests) {
        const updated = await updateStreamRequest(request.id, {
          terminalNotifiedAt: terminalAt,
          ...(request.status === 'pending' ? {
            status: 'expired',
            denialReason: canceled ? 'FACEIT canceled the match before staff review.' : 'The FACEIT match finished before staff review.'
          } : {})
        }, STREAM_ACTIVE_STATUSES);
        if (updated) await refreshStreamRequestStaffMessage(updated);
        if (updated?.status === 'approved') await syncStreamRequestToWebsite(updated, canceled ? 'canceled' : 'completed');
      }
      if (canceled) {
        for (const request of new Map(currentRequests.filter((entry) => entry.status === 'approved').map((entry) => [entry.requesterId, entry])).values()) {
          await notifyStreamRequester(request, `FACEIT marked **${request.matchup}** as canceled. No connection details will be sent for this match.`);
        }
      } else {
        await sendPostCastReminder(matchId);
      }
      for (const request of new Map(currentRequests.filter((entry) => entry.status === 'pending').map((entry) => [entry.requesterId, entry])).values()) {
        await notifyStreamRequester(request, canceled
          ? `Your stream request for **${request.matchup}** was closed because FACEIT canceled the match.`
          : `Your stream request for **${request.matchup}** expired because the match finished before it was approved.`);
      }
      continue;
    }
    const approved = currentRequests.filter((request) => request.status === 'approved');
    const scheduledIso = approved.find((request) => request.dateTimeIso)?.dateTimeIso;
    if (scheduledIso && Date.parse(scheduledIso) <= now && approved.some((request) => !request.deliveryPromptSentAt)) {
      await sendStreamDeliveryPrompt(matchId);
    }
  }
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
