import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  LabelBuilder,
  ModalBuilder,
  Partials,
  PermissionFlagsBits,
  REST,
  Routes,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder
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
  saveMainStreamCoverage,
  saveMatchConnection,
  approveScheduleProposal,
  cancelScheduleProposal,
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
  getMainStreamCoverage,
  getMatchConnection,
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
  updateStreamRequest,
  listSeasons,
  seedSeasonsOnce,
  updateSeasons,
  listMainStreamCoverageMatchIds,
  listMainStreamCoverage,
  listMainStreamCoverageWithSchedules,
  getCrewAvailability,
  updateCrewAvailability,
  claimMainStreamDeliveryPrompt,
  deleteMainStreamCoverage,
  getSheetSync,
  updateSheetSync,
  getOpenMatchesDigest,
  claimOpenMatchesDigest,
  saveOpenMatchesDigest
} from './store.js';
import {
  LEGACY_SEASON_SEED,
  PLAYOFF_ROUND_NAMES,
  currentSeason,
  easternDateKey,
  findSeasonByRef,
  findSeasonRound,
  formatRoundLine,
  formatRoundsText,
  formatSeasonRange,
  makeSeasonId,
  parseRoundsText,
  parseSeasonDate,
  planDeleteSeason,
  planStartSeason,
  planUpdateSeason,
  roundWindowForDisplay,
  seasonForDate
} from './season.js';
import { scheduleFaceitMatch } from './faceitSchedule.js';
import { auditMissingCaptains, auditMissingPlayers, getTeamMappingScope, syncRolesFromSheet } from './sheetRoles.js';
import { startWebhookServer } from './webhookServer.js';
import { applyVetoAction, chooseFirstAction, createVeto, expectedVetoAction } from './vetoEngine.js';
import {
  STREAM_ACTIVE_STATUSES,
  STREAM_STAFF_ACTION_STATUSES,
  STREAM_STATUS_LABELS,
  buildCoverageNotice,
  buildMainStreamCoverageNotice,
  buildMainStreamSchedulePost,
  buildMainStreamCancelledNotice,
  buildCrewDm,
  buildCrewRemovedDm,
  removedCrewIds,
  crewRolesFor,
  mergeCrewOptions,
  validateStreamUrl,
  buildCrewIpPing,
  crewUserIds,
  PRODUCTION_CREW_FIELDS,
  buildConnectionDm,
  requestRoomId,
  selectConnectionRecipients,
  STREAM_CONNECTION_STATUSES,
  buildRequestIpMessage,
  parseMainStreamCommand,
  buildLiveBoardNotice,
  isBroadcastLive,
  shouldAutoEndBroadcast,
  splitMatchupTeams,
  buildScheduleChangeNotice,
  classifyFaceitScheduleChange,
  formatEasternDateTimeInput,
  formatScheduleForDiscord,
  selectScheduleChangeRecipients,
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
  parseEasternDateTime,
  buildCstvConnect,
  wantsSeasonPassword,
  parseSeasonPassword,
  validateStreamRequest,
  STREAM_WITHDRAWABLE_STATUSES,
  MY_CASTS_LIMIT,
  buildMyCastsView,
  buildPostCastNudge,
  buildPreCastReminder,
  buildStatsCard,
  castTimeIso,
  computeCasterStats,
  isPostCastNudgeDue,
  isPreCastReminderDue,
  postCastFormState,
  splitMyCasts,
  streamChannelName,
  buildStaffFormNudge,
  groupMissingForms,
  staffNudgeCooldownUntil,
  buildFormsOverview,
  formsCasterSummaries,
  buildCasterFormsView,
  selectFormCasts,
  buildStreamListView,
  isPostCastFormOverdue,
  selectOpenMatches,
  buildOpenMatchesView,
  openMatchesDigestDue,
  UPCOMING_POST_FOOTER
} from './streamRequest.js';
import { parseScheduleClock } from './scheduleInput.js';
import { buildMatchResult } from './matchResult.js';
import {
  CREW_FIELD_ROLES,
  CREW_ROLES,
  CREW_ROLE_LABELS,
  addDaysToKey,
  availabilityAt,
  easternParts,
  mondayOf,
  normalizeCrewName,
  parseAvailability,
  peopleMissingWeek,
  rankCrewForRole,
  weekdayIndex,
  weekKeys
} from './availability.js';
import { createWebsitePublisher } from './websitePublisher.js';
import { buildMainStreamSheetRow, buildScheduleSheetRow, buildStreamLinkSheetRow, createScheduleSheet } from './scheduleSheet.js';
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

const SEASON6_PLAYOFF_ID = 'c0c0b1fd-fa0b-4488-98b8-be7fdeaee7c0';

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
  await loadSeasons().catch((error) => console.error('Could not load seasons:', error));

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
  console.log(`Live board: ${config.liveNowChannelId ? `<#${config.liveNowChannelId}>` : 'off (set LIVE_NOW_CHANNEL_ID to enable)'}`);
  await resyncLiveBoard().catch((error) => console.error('Live board resync failed:', error));
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
      const cfSubcommand = interaction.commandName === 'cf' ? interaction.options.getSubcommand(false) : null;
      if (cfSubcommand === 'mainstream') await handleMainStreamAutocomplete(interaction);
      else if (cfSubcommand === 'crewlink') await handleCrewLinkAutocomplete(interaction);
      else if (interaction.commandName === 'cf') await handleSeasonAutocomplete(interaction);
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
      const streamStaffCommand = interaction.commandName === 'cf'
        && ['streams', 'forms', 'upcoming', 'mainstream', 'whosfree', 'crewlink'].includes(interaction.options.getSubcommand(false));
      const allowed = streamStaffCommand ? canManageStreamRequests(interaction.member) : canUseBotAdminCommand(interaction.member);
      if (!allowed) {
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
    if (interaction.isButton() && interaction.customId.startsWith('crew_open:')) {
      await handleCrewOpenButton(interaction);
      return;
    }
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('crew_stream:')) {
      await handleCrewStreamSelect(interaction);
      return;
    }
    if (interaction.isButton() && /^crew_drop(_yes|_no)?(:|$)/.test(interaction.customId)) {
      await handleCrewDropButton(interaction);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('crew_submit:')) {
      await handleCrewSubmit(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith('upcoming_post:')) {
      await handleUpcomingPostButton(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith('open_request:')) {
      await handleOpenMatchRequestButton(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith('stream_request_cancel:')) {
      await handleStreamRequestCancelButton(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith('stream_retry:')) {
      await handleStreamRetryButton(interaction);
      return;
    }
    if (interaction.isStringSelectMenu() && interaction.customId === 'forms_caster') {
      await handleFormsCasterSelect(interaction);
      return;
    }
    if (interaction.isStringSelectMenu() && (interaction.customId === 'forms_mark_received' || interaction.customId.startsWith('forms_mark:'))) {
      await handleFormsMarkReceived(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId === 'forms_nudge_all') {
      await handleFormsNudgeAll(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId === 'forms_back') {
      await handleFormsBack(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith('forms_nudge:')) {
      await handleFormsNudgeButton(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith('my_casts_share:')) {
      await handleMyCastsShare(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith('stream_live:')) {
      await handleStreamLiveButton(interaction);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('season_rounds_submit:')) {
      await handleSeasonRoundsSubmit(interaction);
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

    if (subcommand === 'season') {
      await handleSeasonCommand(interaction);
      return;
    }

    if (subcommand === 'forms') {
      await showForms(interaction);
      return;
    }

    if (subcommand === 'upcoming') {
      await handlePostUpcomingMatches(interaction);
      return;
    }

    if (subcommand === 'mainstream') {
      await handleMainStreamCommand(interaction);
      return;
    }
    if (subcommand === 'whosfree') {
      await handleWhosFreeCommand(interaction);
      return;
    }
    if (subcommand === 'crewlink') {
      await handleCrewLinkCommand(interaction);
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
    const season = activeSeason();
    const lines = season?.rounds?.length
      ? [`**${season.name}** (${formatSeasonRange(season)})`, ...season.rounds.map((round) => `- ${formatRoundLine(round)}`)]
      : [];
    const configuredRounds = Object.entries(config.roundWindows)
      .map(([name, window]) => `- **${name}**: ${window.start} - ${window.end}`);
    if (configuredRounds.length) lines.push(...(lines.length ? ['', '**Other configured windows**'] : []), ...configuredRounds);
    await interaction.editReply(truncateDiscordMessage(lines.length
      ? lines.join('\n')
      : `No round windows are configured yet for ${configuredFaceitSourceSummary()}. FACEIT scheduled times will be shown once matches are published.`));
    return;
  }
  if (subcommand === 'help') {
    await interaction.editReply([
      '`/crossfire upcoming` - your upcoming approved matches.',
      '`/crossfire team name:<team>` - that team’s matches when you have access.',
      '`/crossfire rounds` - round windows and defaults.',
      '`/crossfire veto` - veto status for this linked match room.',
      `\`/request stream\` - request permission to stream (${streamPlatformLabel()} links accepted).`,
      '`/request open` - every confirmed upcoming match by date and time, tonight highlighted, with a button to request each one.',
      '`/request mine` - your casts, IP status, and any post-cast forms still missing.',
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

// ---------- Seasons (/cf season) ----------
// Seasons live in the data store; this in-memory copy keeps the synchronous scheduling code fast.
// Only this process writes seasons, so refreshing after every change keeps it accurate.
let seasonCache = [];

async function refreshSeasonCache() {
  seasonCache = await listSeasons();
}

async function loadSeasons() {
  const seeded = await seedSeasonsOnce(LEGACY_SEASON_SEED);
  if (seeded) {
    console.log(`[Season] Copied the built-in ${seeded.name} round dates into the data store.`);
    await appendAuditLog({ type: 'season_seeded', seasonId: seeded.id, name: seeded.name });
  }
  await refreshSeasonCache();
}

function seasonTodayKey() {
  return easternDateKey(new Date());
}

function activeSeason() {
  return currentSeason(seasonCache, seasonTodayKey());
}

function seasonDateHelp(field, value) {
  return `Could not read the ${field} date "${value}". Use something like 11/2/2026, Nov 2 or 2026-11-02.`;
}

function seasonRoundsModal(season) {
  const text = formatRoundsText(season);
  const input = new TextInputBuilder()
    .setCustomId('rounds')
    .setLabel('Name | start - end | default time')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(4000)
    .setPlaceholder('Round 1 | 11/2 - 11/4 | 11/3 8:00 PM');
  if (text) input.setValue(text.slice(0, 4000));
  return new ModalBuilder()
    .setCustomId(`season_rounds_submit:${season.id}`)
    .setTitle(`${season.name} round dates`.slice(0, 45))
    .addComponents(new ActionRowBuilder().addComponents(input));
}

function describeCurrentSeason() {
  const current = activeSeason();
  if (!current) return 'There is no current season now.';
  return current.startDate > seasonTodayKey()
    ? `No season is running today; **${current.name}** is next and its round dates are used.`
    : `Current season: **${current.name}**.`;
}

async function handleSeasonCommand(interaction) {
  const action = interaction.options.getString('action', true);
  const ref = interaction.options.getString('season');
  const nameInput = interaction.options.getString('name')?.trim() || null;
  const startInput = interaction.options.getString('start')?.trim() || null;
  const endInput = interaction.options.getString('end')?.trim() || null;

  if (action === 'rounds') {
    // A modal has to be the first response, so this action cannot defer.
    await refreshSeasonCache();
    const season = ref ? findSeasonByRef(seasonCache, ref) : activeSeason();
    if (!season) {
      await interaction.reply({
        content: ref
          ? `No season called "${ref}". See \`/cf season action:list\`.`
          : 'There is no current season. Start one with `/cf season action:start`, or pick one with `season:`.',
        ephemeral: true
      });
      return;
    }
    await interaction.showModal(seasonRoundsModal(season));
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  await refreshSeasonCache();
  const today = seasonTodayKey();

  if (action === 'list') {
    const current = activeSeason();
    const seasons = [...seasonCache].sort((a, b) => b.startDate.localeCompare(a.startDate));
    if (!seasons.length) {
      await interaction.editReply('No seasons yet. Start one with `/cf season action:start name:<name> start:<date>`.');
      return;
    }
    const lines = seasons.map((season) =>
      `- **${season.name}** · ${formatSeasonRange(season)} · ${season.rounds?.length || 0} round(s)${current?.id === season.id ? ' · current' : ''}`);
    if (current) lines.push(`CSTV password: ${current.cstvPassword ? 'set' : 'not set (`/cf season action:set CSTV password`)'}`);
    if (current?.rounds?.length) lines.push('', `**${current.name} rounds**`, ...current.rounds.map((round) => `- ${formatRoundLine(round)}`));
    else if (current) lines.push('', `${current.name} has no round dates yet. Add them with \`/cf season action:rounds\`.`);
    await interaction.editReply(truncateDiscordMessage(lines.join('\n')));
    return;
  }

  if (action === 'start') {
    if (!nameInput || !startInput) {
      await interaction.editReply('Give the season a `name` and a `start` date, for example `/cf season action:start name:Season 8 start:1/10/2027`.');
      return;
    }
    const startDate = parseSeasonDate(startInput, { defaultYear: Number(today.slice(0, 4)), after: today });
    if (!startDate) {
      await interaction.editReply(seasonDateHelp('start', startInput));
      return;
    }
    const endDate = endInput ? parseSeasonDate(endInput, { defaultYear: Number(startDate.slice(0, 4)), after: startDate }) : null;
    if (endInput && !endDate) {
      await interaction.editReply(seasonDateHelp('end', endInput));
      return;
    }
    const result = await updateSeasons((seasons) => planStartSeason(seasons, {
      id: makeSeasonId(nameInput, seasons),
      name: nameInput,
      startDate,
      endDate,
      actorId: interaction.user.id
    }));
    if (result.error) {
      await interaction.editReply(`Nothing changed. ${result.error}`);
      return;
    }
    await refreshSeasonCache();
    await appendAuditLog({
      type: 'season_started',
      actorId: interaction.user.id,
      seasonId: result.season.id,
      name: result.season.name,
      startDate,
      endDate,
      closedSeasonIds: result.closed.map((season) => season.id)
    });
    await interaction.editReply([
      `Started **${result.season.name}** (${formatSeasonRange(result.season)}).`,
      ...result.closed.map((season) => `**${season.name}** now ends the day before (${formatSeasonRange(season)}).`),
      `Next, add its round dates with \`/cf season action:rounds season:${result.season.name}\`.`,
      describeCurrentSeason()
    ].join('\n'));
    return;
  }

  const season = ref ? findSeasonByRef(seasonCache, ref) : action === 'delete' ? null : activeSeason();
  if (!season) {
    await interaction.editReply(ref
      ? `No season called "${ref}". See \`/cf season action:list\`.`
      : action === 'delete'
        ? 'Pick the season to delete with `season:`.'
        : 'There is no current season. Pick one with `season:`.');
    return;
  }

  if (action === 'edit') {
    if (!nameInput && !startInput && !endInput) {
      await interaction.editReply('Give a new `name`, `start` or `end`. Use `end:none` to remove the end date.');
      return;
    }
    const patch = {};
    if (nameInput) patch.name = nameInput;
    if (startInput) {
      patch.startDate = parseSeasonDate(startInput, { defaultYear: Number(season.startDate.slice(0, 4)) });
      if (!patch.startDate) {
        await interaction.editReply(seasonDateHelp('start', startInput));
        return;
      }
    }
    if (endInput) {
      const startDate = patch.startDate || season.startDate;
      patch.endDate = /^(none|open|clear|-)$/i.test(endInput)
        ? null
        : parseSeasonDate(endInput, { defaultYear: Number(startDate.slice(0, 4)), after: startDate });
      if (patch.endDate === undefined || (patch.endDate === null && !/^(none|open|clear|-)$/i.test(endInput))) {
        await interaction.editReply(seasonDateHelp('end', endInput));
        return;
      }
    }
    const result = await updateSeasons((seasons) => planUpdateSeason(seasons, season.id, patch));
    if (result.error) {
      await interaction.editReply(`Nothing changed. ${result.error}`);
      return;
    }
    await refreshSeasonCache();
    await appendAuditLog({
      type: 'season_edited',
      actorId: interaction.user.id,
      seasonId: season.id,
      before: { name: season.name, startDate: season.startDate, endDate: season.endDate || null },
      after: { name: result.season.name, startDate: result.season.startDate, endDate: result.season.endDate || null }
    });
    await interaction.editReply(`Updated **${result.season.name}** (${formatSeasonRange(result.season)}).\n${describeCurrentSeason()}`);
    return;
  }

  if (action === 'password') {
    const parsed = parseSeasonPassword(interaction.options.getString('password'));
    if (!parsed.valid) {
      await interaction.editReply(parsed.error);
      return;
    }
    const result = await updateSeasons((seasons) => planUpdateSeason(seasons, season.id, { cstvPassword: parsed.value }));
    if (result.error) {
      await interaction.editReply(`Nothing changed. ${result.error}`);
      return;
    }
    await refreshSeasonCache();
    // The password itself never goes in the audit log.
    await appendAuditLog({ type: 'season_cstv_password_set', actorId: interaction.user.id, seasonId: season.id, cleared: !parsed.value }).catch(() => null);
    await interaction.editReply(parsed.value
      ? `Saved the CSTV password for **${season.name}**. It's added to every IP sent from now on (type **No** in the form's password box to skip it for one match).`
      : `Removed the CSTV password for **${season.name}**. IPs are sent without one.`);
    return;
  }

  if (action === 'end') {
    const endDate = endInput ? parseSeasonDate(endInput, { defaultYear: Number(season.startDate.slice(0, 4)), after: season.startDate }) : today;
    if (!endDate) {
      await interaction.editReply(seasonDateHelp('end', endInput));
      return;
    }
    const result = await updateSeasons((seasons) => planUpdateSeason(seasons, season.id, { endDate }));
    if (result.error) {
      await interaction.editReply(`Nothing changed. ${result.error}`);
      return;
    }
    await refreshSeasonCache();
    await appendAuditLog({ type: 'season_ended', actorId: interaction.user.id, seasonId: season.id, name: season.name, endDate });
    await interaction.editReply(`**${result.season.name}** now ends on ${formatSeasonRange(result.season).split(' – ')[1]}.\n${describeCurrentSeason()}`);
    return;
  }

  if (action === 'delete') {
    const result = await updateSeasons((seasons) => planDeleteSeason(seasons, season.id));
    if (result.error) {
      await interaction.editReply(`Nothing changed. ${result.error}`);
      return;
    }
    await refreshSeasonCache();
    await appendAuditLog({
      type: 'season_deleted',
      actorId: interaction.user.id,
      seasonId: season.id,
      name: season.name,
      startDate: season.startDate,
      endDate: season.endDate || null,
      roundCount: season.rounds?.length || 0
    });
    await interaction.editReply(`Deleted **${season.name}** and its ${season.rounds?.length || 0} round(s).\n${describeCurrentSeason()}`);
    return;
  }

  await interaction.editReply('Unknown season action.');
}

async function handleSeasonRoundsSubmit(interaction) {
  if (!canUseBotAdminCommand(interaction.member)) {
    await interaction.reply({ content: 'Only admins/match staff can change season dates.', ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const seasonId = interaction.customId.slice('season_rounds_submit:'.length);
  await refreshSeasonCache();
  const season = seasonCache.find((entry) => entry.id === seasonId);
  if (!season) {
    await interaction.editReply('That season no longer exists. Nothing was saved.');
    return;
  }
  const text = interaction.fields.getTextInputValue('rounds') || '';
  const parsed = parseRoundsText(text, season);
  if (parsed.errors.length) {
    await interaction.editReply(truncateDiscordMessage([
      'Nothing was saved. Fix these lines and run `/cf season action:rounds` again:',
      ...parsed.errors.map((error) => `- ${error}`),
      '',
      'What you entered, so you can copy it back:',
      '```',
      text.replace(/```/g, "'''").slice(0, 1500),
      '```'
    ].join('\n')));
    return;
  }
  const result = await updateSeasons((seasons) => planUpdateSeason(seasons, season.id, { rounds: parsed.rounds }));
  if (result.error) {
    await interaction.editReply(`Nothing was saved. ${result.error}`);
    return;
  }
  await refreshSeasonCache();
  await appendAuditLog({
    type: 'season_rounds_updated',
    actorId: interaction.user.id,
    seasonId: season.id,
    name: season.name,
    roundCount: parsed.rounds.length,
    previousRoundCount: season.rounds?.length || 0
  });
  const isCurrent = activeSeason()?.id === season.id;
  await interaction.editReply(truncateDiscordMessage([
    parsed.rounds.length
      ? `Saved ${parsed.rounds.length} round(s) for **${season.name}**:`
      : `Cleared every round from **${season.name}**. Match rooms will show "Scheduling window: not configured yet".`,
    ...parsed.rounds.map((round) => `- ${formatRoundLine(round)}`),
    ...(parsed.warnings.length ? ['', '**Check these**', ...parsed.warnings.map((warning) => `- ${warning}`)] : []),
    '',
    isCurrent
      ? '`!schedule` checks use these dates right away. Run `/cf sync target:matches` to update the pinned intro in existing match rooms.'
      : `${season.name} is not the current season, so these dates apply once it starts.`
  ].join('\n')));
}

async function handleSeasonAutocomplete(interaction) {
  if (!canUseBotAdminCommand(interaction.member)) {
    await interaction.respond([]).catch(() => null);
    return;
  }
  const focused = String(interaction.options.getFocused() || '').toLowerCase();
  await refreshSeasonCache();
  const current = activeSeason();
  const choices = [...seasonCache]
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
    .map((season) => ({
      name: `${season.name} · ${formatSeasonRange(season)}${current?.id === season.id ? ' · current' : ''}`.slice(0, 100),
      value: season.id
    }))
    .filter((choice) => !focused || choice.name.toLowerCase().includes(focused))
    .slice(0, 25);
  await interaction.respond(choices).catch(() => null);
}

async function handleAuditLog(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const matchId = interaction.options.getString('match_id') || null;
  const entries = (await listAuditLog({ matchId })).slice(-40).reverse();
  await interaction.editReply(truncateDiscordMessage(entries.length
    ? entries.map((entry) => `- ${entry.timestamp} | ${entry.type} | actor ${entry.actorId || 'system'}${entry.matchId ? ` | match ${entry.matchId}` : ''}${entry.requestId ? ` | request ${entry.requestId}` : ''}${entry.reason ? ` | ${entry.reason}` : ''}`).join('\n')
    : 'No matching audit events.'));
}

async function handleCommandHelp(interaction) {
  await interaction.reply({
    content: [
      '**CROSSFIRE Admin Commands**',
      '`/cf sync target:matches` - create/update FACEIT match rooms.',
      '`/cf sync target:matches round:Group Stage - Round 1` - sync one group-stage round only.',
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
      '`/cf streams action:list|inspect|cancel` - see, inspect or cancel caster requests (cancel by `request_id:`, `match:` or `caster:`).',
      '`/cf auditlog match_id:<optional>` - inspect scheduling and operations decisions.',
      '`/cf forms` - who owes post-cast forms. Pick a caster to see their casts, nudge them or mark a form received, or press Nudge all.',
      '`/cf upcoming` - post the Upcoming Matches list in the community casters channel now, with or without pinging Community Casters.',
      '`/cf season action:list|start|rounds|edit|end|delete` - set season dates and each round\'s scheduling window.',
      '',
      '**Match Room Commands**',
      '`!schedule November 2 8 PM ET` - propose a match time.',
      '`!propose November 2 8 PM ET` - same as `!schedule`.',
      '`!reschedule November 2 9 PM ET` - request a new time.',
      '`!accept` - accept the open proposal from the other team.',
      '`!decline` - decline the open proposal.',
      '`!cancel` - cancel your open proposal before it is accepted.',
      '`!admin reason here` or `!calladmin reason here` - alert admins with this match room and FACEIT link.',
      '`/request stream` - open the community stream request form (`!request` now points casters here).',
      '`!sendip FACEIT_LINK MESSAGE` - staff immediately DM connection details to approved casters. Without a message it reposts the IP prompt.',
      '`/cf mainstream match:<link> stream:<channel> caster1:@ producer:@ …` - staff put a match on the official stream, set its crew, or `remove:True` to take it off.',
      '',
      '**Public Slash Commands**',
      '`/request stream` - submit a stream request; `/request open` lists every confirmed upcoming match; `/request cancel` cancels your pending request.',
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

    if (content.toLowerCase() === '!cancel') {
      await handleTextCancelProposal(message);
    }

    if (/^!(calladmin|admin)\b/i.test(content)) {
      await handleCallAdmin(message, content);
    }

    if (/^!request\b/i.test(content)) {
      const mainStream = parseMainStreamCommand(content);
      if (mainStream) {
        await message.reply('Main stream moved to `/cf mainstream match:<FACEIT link>`. Pick the `stream:` and crew (`caster1:`, `producer:` …) right in the command; `remove:True` takes a match off the main stream.');
      }
      else await handleTextStreamRequest(message);
    }

    if (/^!cancelreq\b/i.test(content)) {
      await message.reply({
        content: 'Canceling moved to `/cf streams action:cancel`. Give it `match:` (FACEIT link), `caster:` or `request_id:`.',
        allowedMentions: { repliedUser: false }
      });
    }

    if (/^!resendip\b/i.test(content)) {
      await message.reply({
        content: 'Use `!sendip FACEIT_LINK` with no message to repost the IP prompt.',
        allowedMentions: { repliedUser: false }
      });
    }

    if (/^!sendip\b/i.test(content)) {
      await handleSendIp(message, content);
    }

    if (/^!add\s*game\b/i.test(content)) {
      await handleAddGameToSheet(message, content);
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

  for (const message of messages.values()) {
    if (message.author?.id !== client.user?.id) continue;
    // Newest messages are checked first. A decision/cancellation closes any
    // older proposal so restart recovery cannot resurrect it.
    if (isScheduleResolutionMessage(message, stored.match)) return null;
    if (isScheduleProposalMessage(message, stored.match)) return buildProposalFromMessage(message, stored);
  }
  return null;
}

function isScheduleResolutionMessage(message, match) {
  const matchTitle = `${match.teamA} vs ${match.teamB}`;
  const content = String(message.content || '');
  const titles = (message.embeds || []).map((embed) => String(embed.title || '')).join('\n');
  const text = `${content}\n${titles}`;
  return /(schedule|reschedule).*(accepted|declined|canceled|approved|denied|submitted by tournament ops)/i.test(text)
    && (content.includes(matchTitle) || (message.embeds || []).some((embed) => String(embed.description || '').includes(matchTitle)));
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

async function handleTextCancelProposal(message) {
  const stored = await getStoredMatchForChannel(message.channel);
  if (!stored) {
    await message.reply(await buildUnlinkedMatchChannelMessage(message.channel, [
      'Use `!cancel` inside a match channel created by the bot.',
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
  const canCancel = proposal.proposedBy === message.author.id || isAuthorizedStaffMember(member, config);
  if (!canCancel) {
    await message.reply('Only the person who proposed this time or an authorized staff member can cancel it.');
    return;
  }

  if (!await getScheduleProposal(proposal.id)) await saveScheduleProposal(proposal);
  const canceled = await cancelScheduleProposal(proposal.id, message.author.id);
  if (!canceled) {
    await message.reply('That proposal has already been accepted, declined, or canceled.');
    return;
  }

  await clearPendingScheduleFromChannelTopic(message.channel, proposal.id);
  await appendAuditLog({
    type: 'schedule_proposal_canceled',
    matchId: stored.match.id,
    actorId: message.author.id,
    proposalId: proposal.id,
    scheduledAt: proposal.scheduledAt
  });
  await message.channel.send({
    embeds: [scheduleStatusEmbed({
      title: proposal.kind === 'reschedule' ? 'Reschedule Proposal Canceled' : 'Schedule Proposal Canceled',
      color: 0x7f8c8d,
      stored,
      proposal,
      timeLabel: 'Canceled Time',
      actorLabel: 'Canceled By',
      actorId: message.author.id,
      footer: 'A team member can propose a new time with !schedule November 6 9:00 PM EST.'
    })]
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

// `!request` for casters was retired in favour of `/request stream`; point anyone who still types it there.
async function handleTextStreamRequest(message) {
  await message.reply({
    content: 'Stream requests now use `/request stream`. Type it in this channel to open the request form.',
    allowedMentions: { repliedUser: false }
  });
}

async function handleStreamRequestCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'mine') {
    await handleMyCasts(interaction);
    return;
  }
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
  if (subcommand === 'open') {
    await handleOpenMatches(interaction);
    return;
  }
  await showStreamRequestModal(interaction);
}

// `/request open`: upcoming matches casters can request (co-casting included), each with a button
// that opens the request form with its FACEIT link filled in. Only the caster sees it.
async function handleOpenMatches(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const open = await loadOpenMatches({ viewerId: interaction.user.id });
  await interaction.editReply({ ...buildOpenMatchesPayload(open, { content: '**Upcoming Matches**' }), allowedMentions: { parse: [] } });
}

async function loadOpenMatches({ viewerId = null, now = Date.now() } = {}) {
  const [matches, schedules, requests, mainStreamMatchIds] = await Promise.all([
    listStoredMatches(),
    listSchedules(),
    listStreamRequests(),
    listMainStreamCoverageMatchIds()
  ]);
  return selectOpenMatches({ matches, schedules, requests, mainStreamMatchIds }, { now, viewerId });
}

// withButtons: false is the channel post (daily and /cf upcoming): just the list, no buttons.
function buildOpenMatchesPayload(open, { content = '**Upcoming Matches**', withButtons = true } = {}) {
  const view = buildOpenMatchesView(open, withButtons ? {} : { footer: UPCOMING_POST_FOOTER });
  const buttons = (withButtons ? view.buttons : []).map((entry) => new ButtonBuilder()
    .setCustomId(`open_request:${entry.matchId}`)
    .setLabel(entry.matchup.slice(0, 80))
    .setEmoji(entry.tonight ? '🔥' : '🎙️')
    .setStyle(entry.approved || entry.pending ? ButtonStyle.Secondary : ButtonStyle.Primary)
    .setDisabled(Boolean(entry.mine)));
  const rows = [];
  for (let index = 0; index < buttons.length; index += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(index, index + 5)));
  const embeds = view.embeds.map((data) => {
    const embed = new EmbedBuilder().setDescription(data.description).setColor(data.color);
    if (data.title) embed.setTitle(data.title);
    if (data.footer) embed.setFooter({ text: data.footer });
    return embed;
  });
  return { content, embeds, components: rows };
}

// Posts the open matches list in the community caster channel once a day at OPEN_MATCHES_POST_TIME
// (Eastern), pinging COMMUNITY_CASTER_ROLE_ID. Nothing is posted (and nobody pinged) on a day with
// no upcoming matches.
async function postOpenMatchesDigest(now = Date.now()) {
  if (!config.openMatchesChannelId) return;
  const last = await getOpenMatchesDigest();
  const dateKey = openMatchesDigestDue(now, { time: config.openMatchesPostTime, lastDateKey: last?.dateKey || null });
  if (!dateKey || !(await claimOpenMatchesDigest(dateKey))) return;
  const open = await loadOpenMatches({ now });
  if (!open.length) {
    await saveOpenMatchesDigest({ skipped: 'no_matches', messageId: null, count: 0 });
    await appendAuditLog({ type: 'open_matches_digest_skipped', dateKey, reason: 'no_matches' });
    return;
  }
  const channel = await client.channels.fetch(config.openMatchesChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) {
    console.warn(`[Stream] daily open matches post skipped: channel ${config.openMatchesChannelId} is not reachable.`);
    await saveOpenMatchesDigest({ skipped: 'channel_unreachable', messageId: null, count: open.length });
    return;
  }
  const roleId = config.communityCasterRoleId;
  const message = await sendUpcomingMatchesPost(channel, open, { ping: true });
  await saveOpenMatchesDigest({ messageId: message?.id || null, channelId: channel.id, count: open.length, postedAt: message ? new Date().toISOString() : null });
  await appendAuditLog({ type: 'open_matches_digest_posted', dateKey, channelId: channel.id, messageId: message?.id || null, count: open.length, pinged: Boolean(roleId && message) });
}

// Sends the Upcoming Matches post, optionally pinging the Community Caster role. Returns the
// message, or null if Discord refused it.
async function sendUpcomingMatchesPost(channel, open, { ping = true } = {}) {
  const roleId = ping ? config.communityCasterRoleId : null;
  return channel.send({
    ...buildOpenMatchesPayload(open, { content: `${roleId ? `<@&${roleId}> ` : ''}**Upcoming Matches**`, withButtons: false }),
    allowedMentions: { parse: [], roles: roleId ? [roleId] : [] }
  }).catch((error) => {
    console.error('Upcoming Matches post failed:', error);
    return null;
  });
}

// `/cf upcoming`: staff post the Upcoming Matches list right away. The reply (only staff see it)
// has two buttons: post and ping Community Casters, or post without a ping. It does not replace the
// 5 PM daily post.
function upcomingPostChannelId(interaction) {
  return config.openMatchesChannelId || interaction.channelId;
}

async function handlePostUpcomingMatches(interaction) {
  const open = await loadOpenMatches();
  const channelId = upcomingPostChannelId(interaction);
  if (!open.length) {
    await interaction.reply({ content: 'There are no confirmed upcoming matches, so there is nothing to post.', ephemeral: true });
    return;
  }
  const buttons = [];
  if (config.communityCasterRoleId) {
    buttons.push(new ButtonBuilder().setCustomId('upcoming_post:ping').setLabel('Post & ping Community Casters').setEmoji('📣').setStyle(ButtonStyle.Primary));
  }
  buttons.push(new ButtonBuilder().setCustomId('upcoming_post:quiet').setLabel('Post without ping').setEmoji('📋').setStyle(ButtonStyle.Secondary));
  await interaction.reply({
    content: `Post the Upcoming Matches list (${open.length} match${open.length === 1 ? '' : 'es'}) in <#${channelId}>?`,
    components: [new ActionRowBuilder().addComponents(buttons)],
    ephemeral: true
  });
}

async function handleUpcomingPostButton(interaction) {
  if (!canManageStreamRequests(interaction.member)) {
    await interaction.reply({ content: 'Only admins/stream staff can post the Upcoming Matches list.', ephemeral: true });
    return;
  }
  await interaction.deferUpdate();
  const ping = interaction.customId === 'upcoming_post:ping';
  const channelId = upcomingPostChannelId(interaction);
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) {
    await interaction.editReply({ content: `I can't post in <#${channelId}>.`, components: [] });
    return;
  }
  const open = await loadOpenMatches();
  if (!open.length) {
    await interaction.editReply({ content: 'There are no confirmed upcoming matches anymore, so nothing was posted.', components: [] });
    return;
  }
  const message = await sendUpcomingMatchesPost(channel, open, { ping });
  const pinged = Boolean(ping && config.communityCasterRoleId && message);
  await appendAuditLog({ type: 'open_matches_posted_by_staff', actorId: interaction.user.id, channelId: channel.id, messageId: message?.id || null, count: open.length, pinged });
  await interaction.editReply({
    content: message
      ? `Posted Upcoming Matches (${open.length}) in <#${channel.id}>${pinged ? ` and pinged <@&${config.communityCasterRoleId}>` : ' without a ping'}: ${message.url}`
      : `Could not post in <#${channel.id}>. Check the bot can send messages and embeds there.`,
    components: [],
    allowedMentions: { parse: [] }
  });
}

// A match button on `/request open`: the normal request form with that match's FACEIT link.
async function handleOpenMatchRequestButton(interaction) {
  if (!streamRequestChannelAllowed(interaction.channelId)) {
    await interaction.reply({ content: streamCommunityChannelHint(), ephemeral: true });
    return;
  }
  const matchId = interaction.customId.slice('open_request:'.length);
  // The daily post stays in the channel, so the match may have started or moved to the main stream.
  if (!(await loadOpenMatches()).some((entry) => entry.matchId === matchId && !entry.mainStream)) {
    await interaction.reply({
      content: 'That match is no longer open to request: it has started, been canceled or rescheduled without a time, or moved to the main stream. Use `/request open` for the current list.',
      ephemeral: true
    });
    return;
  }
  const stored = await getStoredMatch(matchId);
  const faceitUrl = stored?.match?.faceitUrl || `https://www.faceit.com/en/cs2/room/${matchId}`;
  await showStreamRequestModal(interaction, { faceitUrl });
}

function streamPlatformLabel() {
  const platforms = config.streamAllowedPlatforms.length ? config.streamAllowedPlatforms : ['twitch', 'youtube', 'kick'];
  return platforms.map((platform) => ({ twitch: 'Twitch', youtube: 'YouTube', kick: 'Kick' }[platform] || platform)).join('/');
}

// Notes from the post-cast form check at form-open time, picked up when the request is
// created so staff see them on the card. Keyed by requester; lost on restart, which is fine.
const postCastGateNotes = new Map();

async function showStreamRequestModal(interaction, { faceitUrl = null } = {}) {
  const parts = faceitUrl ? [] : interaction.customId?.split(':') || [];
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
  const stored = !faceitUrl && interaction.channel?.id ? await getStoredMatchForChannel(interaction.channel) : null;
  const modal = new ModalBuilder()
    .setCustomId(makeStreamRequestModalId(interaction.user.id, interaction.channelId))
    .setTitle('Request to Stream');
  const fields = [
    ['faceit_url', 'FACEIT matchroom link', faceitUrl || stored?.match?.faceitUrl || '', TextInputStyle.Short],
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
function streamCasterWithdrawRow(request, { live = false } = {}) {
  const row = new ActionRowBuilder();
  if (live && config.liveNowChannelId && request.status === 'approved') row.addComponents(streamCasterLiveButton(request));
  return row.addComponents(
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
  await cancelCoverageNotice(updated, { reason: 'The caster withdrew.', actorId: interaction.user.id });
  await endBroadcast(updated, { actorId: interaction.user.id, reason: 'withdrawn' });
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
    embeds: [embed],
    components: streamReviewComponents(request),
    allowedMentions: { roles: [], users: [], repliedUser: false }
  });
  await updateStreamRequest(request.id, { staffChannelId: channel.id, staffMessageId: message.id, staffPostError: null }, ['pending']);
}

// `/request mine`: only the caster sees it. Past casts still missing a form are checked against the
// form sheet first, so a form sent since the last check shows as received.
async function handleMyCasts(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const requesterId = interaction.user.id;
  let requests = await listStreamRequests({ requesterId });
  const toCheck = splitMyCasts(requests, { requesterId }).past
    .slice(0, MY_CASTS_LIMIT)
    .filter((request) => postCastFormState(request) === 'missing')
    .map((request) => request.id);
  const check = await checkFormsInSheet(toCheck, '/request mine');
  const formCheckFailed = check.failed;
  if (check.foundIds.length) requests = await listStreamRequests({ requesterId });
  const stats = computeCasterStats(requests, { requesterId, season: statsSeason() });
  const view = buildMyCastsView(requests, { requesterId, formLink: postCastFormLinkFor, formCheckFailed, stats });
  const embed = new EmbedBuilder()
    .setTitle('🎙️ Your casts')
    .setDescription(view.description.slice(0, 4096))
    .setColor(0x9146ff);
  const buttons = view.missingForms
    .filter((form) => /^https?:\/\//i.test(form.url))
    .slice(0, 25)
    .map((form) => new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setURL(form.url)
      .setLabel(`Form: ${form.matchup}`.slice(0, 80)));
  const rows = [];
  for (let index = 0; index < buttons.length; index += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(index, index + 5)));
  if (view.pastCount && rows.length < 5) {
    rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder()
      .setCustomId(`my_casts_share:${requesterId}`)
      .setLabel('Share my stats')
      .setEmoji('📣')
      .setStyle(ButtonStyle.Primary)));
  }
  await interaction.editReply({ embeds: [embed], components: rows });
}

// Asks the form sheet about casts still missing a form and records any it finds, so every view
// agrees with the sheet. `failed` means at least one batch could not be checked.
async function checkFormsInSheet(requestIds, context) {
  const ids = [...new Set(requestIds || [])];
  const foundIds = [];
  let failed = false;
  for (let index = 0; index < ids.length; index += 50) {
    const batch = ids.slice(index, index + 50);
    const lookup = await scheduleSheet.lookupPostCastForms(batch)
      .catch((error) => ({ ok: false, error: error?.message || String(error), found: {} }));
    if (!lookup.ok) {
      failed = true;
      console.error(`Post-cast form check for ${context} could not run: ${lookup.error}`);
      continue;
    }
    for (const id of batch) {
      const hit = lookup.found?.[id];
      if (!hit) continue;
      const updated = await updateStreamRequest(id, {
        postCastFormSubmittedAt: hit.submittedAt || new Date().toISOString(),
        postCastFormSource: 'form'
      });
      await appendAuditLog({ type: 'stream_post_cast_form_received', matchId: updated?.matchId || null, requestId: id, source: 'sheet' });
      foundIds.push(id);
    }
  }
  return { foundIds, failed };
}

// Every cast still missing its form, grouped by caster, after checking the sheet.
async function missingFormGroups(requesterId = null) {
  const since = config.postCastFormGateSince;
  const load = async () => groupMissingForms(await listStreamRequests(requesterId ? { requesterId } : {}), { since });
  let groups = await load();
  const check = await checkFormsInSheet(groups.flatMap((group) => group.requests.map((request) => request.id)), 'the missing forms list');
  if (check.foundIds.length) groups = await load();
  return { groups, since, sheetCheckFailed: check.failed, arrived: check.foundIds.length };
}

// `/cf forms`: one line per caster who owes forms, a menu to open any caster, and a Nudge all
// button. Picking a caster swaps the same message to their view (see buildCasterFormsPayload).
async function showForms(interaction) {
  await interaction.deferReply({ ephemeral: true });
  await interaction.editReply(await buildFormsPayload({ checkSheet: true }));
}

// Loads stream requests (all, or one caster's). With checkSheet, missing forms are looked up on
// the form sheet first so a form that just came in shows as submitted.
async function loadFormRequests({ checkSheet = true, casterId = null } = {}) {
  const since = config.postCastFormGateSince;
  const filter = casterId ? { requesterId: casterId } : {};
  let requests = await listStreamRequests(filter);
  let sheetCheckFailed = false;
  if (checkSheet) {
    const check = await checkFormsInSheet(selectFormCasts(requests, { since }).missing.map((request) => request.id), '/cf forms');
    sheetCheckFailed = check.failed;
    if (check.foundIds.length) requests = await listStreamRequests(filter);
  }
  return { requests, since, sheetCheckFailed };
}

function formsDeniedReply(interaction) {
  return interaction.reply({ content: 'Only admins/stream staff can manage post-cast forms.', ephemeral: true });
}

async function buildFormsPayload({ checkSheet = true } = {}) {
  const { requests, since, sheetCheckFailed } = await loadFormRequests({ checkSheet });
  const summaries = formsCasterSummaries(requests, { since });
  const owing = summaries.filter((row) => row.missing);
  const rows = [];
  if (summaries.length) {
    rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
      .setCustomId('forms_caster')
      .setPlaceholder('Pick a caster…')
      .addOptions(summaries.slice(0, 25).map((row) => ({
        label: String(row.tag || row.id).slice(0, 100),
        description: row.missing ? `${row.missing} missing · ${row.rate}% in` : `All in · ${row.submitted} submitted`,
        emoji: row.missing ? '❌' : '✅',
        value: row.id
      })))));
  }
  if (owing.length) {
    rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder()
      .setCustomId('forms_nudge_all')
      .setLabel(`Nudge all (${owing.length})`)
      .setEmoji('📨')
      .setStyle(ButtonStyle.Primary)));
  }
  const embed = new EmbedBuilder()
    .setTitle('📝 Post-cast forms')
    .setDescription(buildFormsOverview(summaries, { sheetCheckFailed }))
    .setColor(owing.length ? 0xf1c40f : 0x2ecc71);
  return { content: '', embeds: [embed], components: rows, allowedMentions: { parse: [] } };
}

async function buildCasterFormsPayload(casterId, { checkSheet = true } = {}) {
  const { requests, since, sheetCheckFailed } = await loadFormRequests({ checkSheet, casterId });
  const view = buildCasterFormsView(requests, { casterId, since, sheetCheckFailed });
  const tag = requests.find((request) => request.requesterTag)?.requesterTag || null;
  const buttons = [];
  if (view.missing.length) {
    buttons.push(new ButtonBuilder()
      .setCustomId(`forms_nudge:${casterId}`)
      .setLabel(view.cooldownUntil ? 'Nudged recently' : 'Nudge')
      .setEmoji('📨')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(Boolean(view.cooldownUntil)));
  }
  buttons.push(new ButtonBuilder().setCustomId('forms_back').setLabel('Back').setEmoji('◀️').setStyle(ButtonStyle.Secondary));
  const rows = [new ActionRowBuilder().addComponents(buttons)];
  if (view.missing.length) {
    rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
      .setCustomId(`forms_mark:${casterId}`)
      .setPlaceholder('Mark a form received…')
      .addOptions(view.missing.slice(0, 25).map((request) => ({
        label: String(request.matchup || request.id).slice(0, 100),
        description: `Request ${request.id}`.slice(0, 100),
        value: request.id
      })))));
  }
  const embed = new EmbedBuilder()
    .setTitle(`📝 Post-cast forms · ${tag || 'caster'}`.slice(0, 256))
    .setDescription(view.description)
    .setColor(view.missing.length ? 0xf1c40f : 0x2ecc71);
  return { content: '', embeds: [embed], components: rows, allowedMentions: { parse: [] } };
}

// The "Pick a caster" menu: swaps the message to that caster's view.
async function handleFormsCasterSelect(interaction) {
  if (!canManageStreamRequests(interaction.member)) return formsDeniedReply(interaction);
  const casterId = interaction.values?.[0];
  await interaction.deferUpdate();
  await interaction.editReply(await buildCasterFormsPayload(casterId, { checkSheet: true }));
}

async function handleFormsBack(interaction) {
  if (!canManageStreamRequests(interaction.member)) return formsDeniedReply(interaction);
  await interaction.deferUpdate();
  await interaction.editReply(await buildFormsPayload({ checkSheet: false }));
}

// The "Mark a form received" menu on a caster's view: for a form sent without its request ID.
// (`forms_mark_received` is the older main-view menu, still answered for messages already open.)
async function handleFormsMarkReceived(interaction) {
  if (!canManageStreamRequests(interaction.member)) return formsDeniedReply(interaction);
  await interaction.deferUpdate();
  const casterId = interaction.customId.startsWith('forms_mark:') ? interaction.customId.slice('forms_mark:'.length) : null;
  const requestId = interaction.values?.[0];
  const updated = requestId ? await markPostCastFormReceived(requestId, interaction.user.id) : null;
  await interaction.editReply(casterId
    ? await buildCasterFormsPayload(casterId, { checkSheet: false })
    : await buildFormsPayload({ checkSheet: false }));
  await interaction.followUp({
    content: updated
      ? `Marked the form for **${updated.matchup}** (<@${updated.requesterId}>) received.`
      : 'That cast could not be marked received. It may have changed; run `/cf forms` again.',
    ephemeral: true,
    allowedMentions: { parse: [] }
  });
}

// DMs one caster every form they still owe and records the nudge on each cast. A staff nudge also
// counts as the automatic 48-hour one.
async function sendStaffFormNudge(casterId, missing, actorId, { bulk = false } = {}) {
  const sent = await dmStreamRequester(missing[0], buildStaffFormNudge(missing, {
    formLink: postCastFormLinkFor,
    gate: config.postCastFormGate
  }));
  const now = new Date().toISOString();
  if (sent) {
    for (const request of missing) {
      await updateStreamRequest(request.id, {
        postCastStaffNudgeAt: now,
        postCastStaffNudgeBy: actorId,
        ...(request.postCastNudgeSentAt ? {} : { postCastNudgeSentAt: now, postCastNudgeDelivery: 'delivered' })
      }, ['approved']);
    }
  }
  await appendAuditLog({
    type: 'stream_post_cast_staff_nudge',
    actorId,
    casterId,
    requestIds: missing.map((request) => request.id),
    delivered: sent,
    bulk
  });
  return sent;
}

// The Nudge button on a caster's view: re-checks the sheet, then DMs them every form they still
// owe. Staff can nudge the same caster once an hour.
async function handleFormsNudgeButton(interaction) {
  if (!canManageStreamRequests(interaction.member)) return formsDeniedReply(interaction);
  const casterId = interaction.customId.slice('forms_nudge:'.length);
  await interaction.deferUpdate();
  const { groups, arrived } = await missingFormGroups(casterId);
  const missing = groups.find((group) => group.requesterId === casterId)?.requests || [];
  let content;
  if (!missing.length) {
    content = `<@${casterId}> has no missing forms now${arrived ? ` (${arrived} just showed up on the sheet)` : ''}. Nothing was sent.`;
  } else {
    const until = staffNudgeCooldownUntil(missing);
    if (until) {
      content = `<@${casterId}> was already nudged by staff. You can nudge again ${discordTimestamp(new Date(until).toISOString(), 'R')}.`;
    } else {
      const sent = await sendStaffFormNudge(casterId, missing, interaction.user.id);
      content = sent
        ? `📨 DMed <@${casterId}> about ${missing.length} missing form(s): ${missing.map((request) => request.matchup || request.id).join(', ')}.`
        : `⚠️ Could not DM <@${casterId}>. Their DMs are closed, so reach out another way.`;
    }
  }
  await interaction.editReply(await buildCasterFormsPayload(casterId, { checkSheet: false }));
  await interaction.followUp({ content, ephemeral: true, allowedMentions: { parse: [] } });
}

// The Nudge all button: re-checks the sheet once, then DMs every caster who still owes forms,
// skipping anyone staff nudged in the last hour.
async function handleFormsNudgeAll(interaction) {
  if (!canManageStreamRequests(interaction.member)) return formsDeniedReply(interaction);
  await interaction.deferUpdate();
  const { groups, sheetCheckFailed } = await missingFormGroups();
  const sent = [];
  const failed = [];
  const waiting = [];
  for (const group of groups) {
    if (staffNudgeCooldownUntil(group.requests)) {
      waiting.push(group);
      continue;
    }
    const delivered = await sendStaffFormNudge(group.requesterId, group.requests, interaction.user.id, { bulk: true });
    (delivered ? sent : failed).push(group);
  }
  const mentions = (list) => list.map((group) => `<@${group.requesterId}>`).join(', ');
  const forms = sent.reduce((sum, group) => sum + group.requests.length, 0);
  const lines = [
    groups.length ? null : 'Nobody owes a form right now. Nothing was sent.',
    sent.length ? `📨 Nudged ${sent.length} caster(s) about ${forms} missing form(s): ${mentions(sent)}.` : null,
    waiting.length ? `⏳ Skipped ${waiting.length} nudged by staff in the last hour: ${mentions(waiting)}.` : null,
    failed.length ? `⚠️ Could not DM ${failed.length} (DMs closed), so reach out another way: ${mentions(failed)}.` : null,
    sheetCheckFailed ? '⚠️ The form sheet could not be checked first, so someone who just sent a form may have been nudged.' : null
  ].filter(Boolean);
  await interaction.editReply(await buildFormsPayload({ checkSheet: false }));
  await interaction.followUp({ content: lines.join('\n').slice(0, 2000), ephemeral: true, allowedMentions: { parse: [] } });
}

// Stats count the season running today; between seasons they cover all time.
function statsSeason() {
  return seasonForDate(seasonCache, seasonTodayKey());
}

// Posts the caster's stats card in the channel, only when they press Share. Upcoming games,
// connection status and links stay private.
async function handleMyCastsShare(interaction) {
  const requesterId = interaction.customId.slice('my_casts_share:'.length);
  if (interaction.user.id !== requesterId) {
    await interaction.reply({ content: 'Only the caster can share these stats. Use `/request mine` to see your own.', ephemeral: true });
    return;
  }
  const stats = computeCasterStats(await listStreamRequests({ requesterId }), { requesterId, season: statsSeason() });
  const card = buildStatsCard(stats, { userId: requesterId });
  const embed = new EmbedBuilder()
    .setTitle(card.title)
    .addFields(card.fields)
    .setColor(0x9146ff);
  if (card.description) embed.setDescription(card.description);
  await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  await appendAuditLog({ type: 'caster_stats_shared', actorId: requesterId, channelId: interaction.channelId || null });
}

// DM each approved caster 30 minutes before game time (see isPreCastReminderDue). The reminder is
// recorded before the DM goes out, so a restart mid-send cannot DM twice.
async function sendPreCastReminders(now = Date.now()) {
  const requests = await listStreamRequests();
  const due = requests.filter((request) => isPreCastReminderDue(request, now));
  const remindedKeys = new Set();
  for (const request of due) {
    const startIso = castTimeIso(request);
    const claimed = await updateStreamRequest(request.id, {
      preCastReminderFor: startIso,
      preCastReminderAt: new Date(now).toISOString()
    }, STREAM_CONNECTION_STATUSES);
    if (!claimed) continue;
    // One reminder per caster per match, even with duplicate requests.
    const roomId = requestRoomId(claimed);
    const key = `${claimed.requesterId}:${roomId || claimed.id}`;
    if (remindedKeys.has(key)) continue;
    remindedKeys.add(key);
    const coCasters = [...new Set(requests
      .filter((other) => other.requesterId !== claimed.requesterId
        && STREAM_CONNECTION_STATUSES.includes(other.status)
        && roomId && requestRoomId(other) === roomId)
      .map((other) => streamChannelName(other.streamUrl) || other.requesterTag)
      .filter(Boolean))];
    const liveBoard = Boolean(config.liveNowChannelId && claimed.status === 'approved');
    const sent = await dmStreamRequester(claimed, {
      content: buildPreCastReminder(claimed, { coCasters, liveBoard }),
      components: liveBoard ? [streamCasterWithdrawRow(claimed, { live: true })] : []
    });
    await updateStreamRequest(claimed.id, { preCastReminderDelivery: sent ? 'delivered' : 'failed' }, STREAM_CONNECTION_STATUSES);
    await appendAuditLog({ type: 'stream_pre_cast_reminder', matchId: claimed.matchId || null, requestId: claimed.id, delivered: sent });
    if (!sent) console.warn(`[Stream] pre-cast reminder for ${claimed.id} could not be delivered (DMs closed?)`);
  }
}

// One DM 48 hours after the post-cast form DM when the form is still missing. The form sheet is
// checked first; a form found there is recorded and no nudge goes out. When the sheet cannot be
// checked, nobody is nudged and the check is retried an hour later.
async function sendPostCastNudges(now = Date.now()) {
  const due = (await listStreamRequests())
    .filter((request) => isPostCastNudgeDue(request, now, { since: config.postCastFormGateSince }))
    .slice(0, 25);
  if (!due.length) return;
  const checkedAt = new Date(now).toISOString();
  for (const request of due) await updateStreamRequest(request.id, { postCastNudgeCheckedAt: checkedAt }, ['approved']);
  const lookup = await scheduleSheet.lookupPostCastForms(due.map((request) => request.id))
    .catch((error) => ({ ok: false, error: error?.message || String(error), found: {} }));
  if (!lookup.ok || lookup.skipped) {
    console.warn(`[Stream] post-cast nudges waiting: the form sheet could not be checked (${lookup.skipped ? 'sheet is in log-only mode' : lookup.error}).`);
    return;
  }
  for (const request of due) {
    const hit = lookup.found?.[request.id];
    if (hit) {
      await updateStreamRequest(request.id, {
        postCastFormSubmittedAt: hit.submittedAt || checkedAt,
        postCastFormSource: 'form'
      }, ['approved']);
      await appendAuditLog({ type: 'stream_post_cast_form_received', matchId: request.matchId || null, requestId: request.id, source: 'sheet' });
      continue;
    }
    const sent = await dmStreamRequester(request, buildPostCastNudge(request, {
      formUrl: postCastFormLinkFor(request.id),
      gate: config.postCastFormGate
    }));
    await updateStreamRequest(request.id, {
      postCastNudgeSentAt: checkedAt,
      postCastNudgeDelivery: sent ? 'delivered' : 'failed'
    }, ['approved']);
    await appendAuditLog({ type: 'stream_post_cast_nudge', matchId: request.matchId || null, requestId: request.id, delivered: sent });
    if (!sent) console.warn(`[Stream] post-cast form nudge for ${request.id} could not be delivered (DMs closed?)`);
  }
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
    await appendAuditLog({ type: 'stream_post_cast_form_received', matchId: outstanding.matchId || null, requestId: outstanding.id, source: 'sheet' });
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
  // Requests sent before stream links were checked may hold a search or directory link.
  // Block those, and save the cleaned-up channel link for the rest.
  const streamCheck = validateStreamUrl(existing.streamUrl, config.streamAllowedPlatforms);
  if (!streamCheck.valid) {
    await interaction.editReply(`This request's stream link isn't a channel page (<${existing.streamUrl}>). Nothing was approved. Deny it and ask <@${existing.requesterId}> to request again with their channel link.\n${streamCheck.error}`);
    return;
  }
  if (streamCheck.value !== existing.streamUrl) {
    await updateStreamRequest(requestId, { streamUrl: streamCheck.value, streamPlatform: streamCheck.platform }, ['pending']);
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
    const coverageNote = await postCoverageNotice(updated);
    const lateIpNote = await sendSavedConnectionToNewCaster(updated).catch(() => null);
    const sheetWarning = await logStreamLinkToSheet(updated, interaction.user.id);
    await appendAuditLog({ type: 'stream_request_published', actorId: interaction.user.id, matchId: updated.matchId, requestId: updated.id, websiteId: updated.websiteId, publisher: websitePublisher.mode });
    await interaction.editReply([
      `✅ Request ${updated.id} approved${websitePublisher.mode === 'http' ? ' and published to the website.' : '. Website publishing is in log-only mode (WEBSITE_ENDPOINT is not set).'}`,
      notified ? null : '⚠️ Could not notify the caster. Check my permissions in their channel and whether their DMs are open.',
      coverageNote ? `⚠️ ${coverageNote}` : null,
      lateIpNote,
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
  const dmSent = await dmStreamRequester(request, { content: dmText, components: [streamCasterWithdrawRow(request, { live: true })] });
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
// --- Team-channel coverage notices -------------------------------------------
// Tells the two teams, in the match channel the bot gave them, that a community
// caster is covering their match, and later that the coverage was cancelled.
// Never throws: the approval/withdrawal must finish even if Discord misbehaves.

function coverageEmbed(notice) {
  return new EmbedBuilder()
    .setColor(notice.color)
    .setTitle(notice.title)
    .setDescription(notice.description)
    .addFields(notice.fields)
    .setFooter({ text: notice.footer })
    .setTimestamp();
}

// The match channel for a stream request: exact FACEIT match id first, then the
// SCL resolver's team-name fallback (stored matches, then a guild channel scan).
// Manual approvals have no match id, so they get no channel.
async function resolveCoverageChannel(request) {
  if (!request?.matchId) return null;
  const teams = splitMatchupTeams(request.matchup);
  const stored = await resolveStoredSclMatch(request.matchId, { teams: teams.map((name) => ({ name })) }).catch(() => null);
  const channelId = stored?.discord?.channelId;
  if (!channelId) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  return channel?.isTextBased?.() ? channel : null;
}

// Posts the "you're being covered" notice once per request. Returns a staff-facing
// note when the teams could not be told, or null when they were (or already had been).
async function postCoverageNotice(request) {
  if (!request || request.coverageMessageId) return null;
  if (!request.matchId) return 'Teams not notified: no match channel linked (manual approval).';
  try {
    const channel = await resolveCoverageChannel(request);
    if (!channel) return `Teams not notified: no match channel found for ${request.matchup}.`;
    const message = await channel.send({ embeds: [coverageEmbed(buildCoverageNotice(request))], allowedMentions: { parse: [] } });
    await updateStreamRequest(request.id, { coverageChannelId: channel.id, coverageMessageId: message.id, coverageCancelledAt: null }, ['approved']);
    await appendAuditLog({ type: 'stream_coverage_posted', matchId: request.matchId, requestId: request.id, channelId: channel.id, messageId: message.id }).catch(() => null);
    return null;
  } catch (error) {
    console.error(`Coverage notice failed for stream request ${request.id}:`, error);
    return `Teams not notified: ${error?.message || error}`;
  }
}

// Tells the two teams, in their match channel, that the official CROSSFIRE stream is covering
// them. Posted once per match (the message id is kept on the main stream coverage record).
// Returns a line for the staff reply. Never throws.
async function postMainStreamCoverageNotice(coverage, { stored = null } = {}) {
  if (coverage?.noticeMessageId) return `The teams were already told in <#${coverage.noticeChannelId}>.`;
  try {
    const teams = splitMatchupTeams(coverage.matchup);
    const match = stored?.discord?.channelId
      ? stored
      : await resolveStoredSclMatch(coverage.matchId, { teams: teams.map((name) => ({ name })) }).catch(() => null);
    const channel = match?.discord?.channelId ? await client.channels.fetch(match.discord.channelId).catch(() => null) : null;
    if (!channel?.isTextBased?.()) return `⚠️ Teams not told: no match channel found for **${coverage.matchup}**.`;
    const schedule = await getSchedule(coverage.matchId).catch(() => null);
    const scheduleIso = schedule?.adminApproved ? (schedule.scheduledAtIso || schedule.scheduledAt || null) : null;
    const notice = buildMainStreamCoverageNotice({ matchup: coverage.matchup, faceitUrl: coverage.faceitUrl, scheduleIso, streamUrl: mainStreamUrlFor(coverage) });
    const message = await channel.send({ embeds: [coverageEmbed(notice)], allowedMentions: { parse: [] } });
    await saveMainStreamCoverage(coverage.matchId, { noticeChannelId: channel.id, noticeMessageId: message.id, noticePostedAt: new Date().toISOString() });
    await appendAuditLog({ type: 'main_stream_coverage_posted', matchId: coverage.matchId, channelId: channel.id, messageId: message.id }).catch(() => null);
    return `Told the teams in <#${channel.id}>.`;
  } catch (error) {
    console.error(`Main stream coverage notice failed for ${coverage?.matchId}:`, error);
    return `⚠️ Teams not told: ${error?.message || error}`;
  }
}

// --- Main stream production schedule post ---------------------------------------
// After `/cf mainstream`, staff can also press "Add production crew" and pick the crew in a form
// (Casters and Producer required). The bot then posts the match in the schedule channel in the
// usual format, pinging the crew. Pressing the button again edits that post instead of reposting.

async function approvedScheduleIso(matchId) {
  const schedule = await getSchedule(matchId).catch(() => null);
  return schedule?.adminApproved ? (schedule.scheduledAtIso || schedule.scheduledAt || null) : null;
}

function mainStreamUrlFor(coverage) {
  return coverage?.streamUrl || config.mainStreamUrls[0] || null;
}

// The controls on the `/cf mainstream` reply: which official stream it is on, and the crew form.
function mainStreamControls(coverage) {
  const rows = [];
  const selected = mainStreamUrlFor(coverage);
  if (config.mainStreamUrls.length) {
    rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
      .setCustomId(`crew_stream:${coverage.matchId}`)
      .setPlaceholder('Which stream?')
      .addOptions(config.mainStreamUrls.slice(0, 25).map((url) => ({
        label: (streamChannelName(url) || url).slice(0, 100),
        description: url.slice(0, 100),
        value: url,
        emoji: '📺',
        default: url === selected
      })))));
  }
  const edit = Boolean(coverage.crew?.producer);
  rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder()
    .setCustomId(`crew_open:${coverage.matchId}`)
    .setLabel(edit ? 'Edit production crew' : 'Add production crew')
    .setEmoji('🎬')
    .setStyle(edit ? ButtonStyle.Secondary : ButtonStyle.Primary)));
  return rows;
}

// The stream dropdown: saves the pick and updates the schedule post and the teams' notice if they
// are already up.
async function handleCrewStreamSelect(interaction) {
  if (!canManageStreamRequests(interaction.member)) {
    await interaction.reply({ content: 'Only admins/stream staff can pick the stream.', ephemeral: true });
    return;
  }
  const matchId = interaction.customId.slice('crew_stream:'.length);
  const streamUrl = interaction.values?.[0];
  if (!(await getMainStreamCoverage(matchId)) || !config.mainStreamUrls.includes(streamUrl)) {
    await interaction.reply({ content: 'That match is not on the main stream anymore. Run `/cf mainstream` again.', ephemeral: true });
    return;
  }
  const coverage = await saveMainStreamCoverage(matchId, { streamUrl });
  await interaction.update({ components: mainStreamControls(coverage) });
  const updated = [];
  if (coverage.scheduleMessageId) {
    const result = await publishMainStreamSchedulePost(coverage);
    if (result.ok) updated.push('the schedule post');
  }
  if (await refreshMainStreamCoverageNotice(coverage)) updated.push('the teams’ notice');
  const sheetLine = await syncMainStreamSheetLink(coverage, interaction.user.id);
  if (sheetLine && !sheetLine.startsWith('⚠️')) updated.push('the Google Sheet');
  await appendAuditLog({ type: 'main_stream_stream_set', actorId: interaction.user.id, matchId, streamUrl }).catch(() => null);
  const lines = [
    updated.length ? `📺 Switched to ${streamUrl} and updated ${updated.join(', ')}.` : null,
    sheetLine && sheetLine.startsWith('⚠️') ? sheetLine : null
  ].filter(Boolean);
  if (lines.length) await interaction.followUp({ content: lines.join('\n'), ephemeral: true });
}

// Re-renders the teams' main stream notice (e.g. after the stream changes). Returns true if edited.
async function refreshMainStreamCoverageNotice(coverage) {
  if (!coverage?.noticeMessageId || !coverage.noticeChannelId) return false;
  const channel = await client.channels.fetch(coverage.noticeChannelId).catch(() => null);
  const message = channel?.isTextBased?.() ? await channel.messages.fetch(coverage.noticeMessageId).catch(() => null) : null;
  if (!message) return false;
  const notice = buildMainStreamCoverageNotice({
    matchup: coverage.matchup,
    faceitUrl: coverage.faceitUrl,
    scheduleIso: await approvedScheduleIso(coverage.matchId),
    streamUrl: mainStreamUrlFor(coverage)
  });
  return Boolean(await message.edit({ embeds: [coverageEmbed(notice)] }).catch(() => null));
}

async function handleCrewOpenButton(interaction) {
  if (!canManageStreamRequests(interaction.member)) {
    await interaction.reply({ content: 'Only admins/stream staff can set the production crew.', ephemeral: true });
    return;
  }
  const matchId = interaction.customId.slice('crew_open:'.length);
  const coverage = await getMainStreamCoverage(matchId);
  if (!coverage) {
    await interaction.reply({ content: 'That match is not on the main stream anymore. Run `/cf mainstream` again.', ephemeral: true });
    return;
  }
  const crew = coverage.crew || {};
  // With the staff schedule read, each dropdown lists only people free for this match.
  const selectOptions = await crewFormSelectOptions(coverage).catch((error) => {
    console.error('[Crew availability] crew form options failed:', error);
    return null;
  });
  const modal = new ModalBuilder()
    .setCustomId(`crew_submit:${matchId}`)
    .setTitle(`Crew · ${coverage.matchup || 'Main stream'}`.slice(0, 45));
  modal.addLabelComponents(...PRODUCTION_CREW_FIELDS.map((field) => {
    const options = selectOptions?.[field.key];
    if (options?.length) {
      const select = new StringSelectMenuBuilder()
        .setCustomId(field.key)
        .setRequired(field.required)
        .setMinValues(field.required ? 1 : 0)
        .setMaxValues(Math.min(field.max, options.length))
        .setPlaceholder('Free people first · (matches this week)')
        .addOptions(options);
      return new LabelBuilder()
        .setLabel(field.label)
        .setDescription(field.key === 'casters' ? 'Caster 1, plus Caster 2 if there is one. Only people free then.' : 'Only people free then, from the staff schedule.')
        .setStringSelectMenuComponent(select);
    }
    const picker = new UserSelectMenuBuilder()
      .setCustomId(field.key)
      .setRequired(field.required)
      .setMinValues(field.required ? 1 : 0)
      .setMaxValues(field.max);
    const defaults = (field.key === 'casters' ? crew.casters || [] : [crew[field.key]]).filter(Boolean);
    if (defaults.length) picker.setDefaultUsers(...defaults);
    const label = new LabelBuilder().setLabel(field.label).setUserSelectMenuComponent(picker);
    if (selectOptions) label.setDescription('Nobody on the staff schedule is free then, so pick anyone.');
    else if (field.description) label.setDescription(field.description);
    return label;
  }));
  await interaction.showModal(modal);
}

async function handleCrewSubmit(interaction) {
  if (!canManageStreamRequests(interaction.member)) {
    await interaction.reply({ content: 'Only admins/stream staff can set the production crew.', ephemeral: true });
    return;
  }
  const matchId = interaction.customId.slice('crew_submit:'.length);
  await interaction.deferReply({ ephemeral: true });
  // Each field is either a "who's free" dropdown (user IDs as values) or a plain user picker.
  const picked = (key) => {
    try {
      const values = interaction.fields.getStringSelectValues(key);
      if (values) return [...values];
    } catch {
      // not a string select
    }
    try {
      return [...(interaction.fields.getSelectedUsers(key)?.keys() || [])];
    } catch {
      return [];
    }
  };
  const crew = {
    casters: picked('casters').slice(0, 2),
    producer: picked('producer')[0] || null,
    observer: picked('observer')[0] || null,
    admin: picked('admin')[0] || null,
    social: picked('social')[0] || null
  };
  if (!crew.casters.length || !crew.producer) {
    await interaction.editReply('Casters and Producer are required. Nothing was posted.');
    return;
  }
  let coverage = await getMainStreamCoverage(matchId);
  if (!coverage) {
    await interaction.editReply('That match is not on the main stream anymore. Run `/cf mainstream` again.');
    return;
  }
  const previousCrew = coverage.crew || {};
  coverage = await saveMainStreamCoverage(matchId, { crew, crewSetBy: interaction.user.id, crewSetAt: new Date().toISOString() });
  const result = await publishMainStreamSchedulePost(coverage);
  const removedLine = await dmRemovedCrewMembers(matchId, previousCrew);
  const ipLine = await pingCrewAboutPostedIp(await getMainStreamCoverage(matchId) || coverage);
  await appendAuditLog({ type: 'main_stream_crew_set', actorId: interaction.user.id, matchId, crew, posted: result.ok }).catch(() => null);
  await interaction.editReply({ content: [result.line, removedLine, ipLine].filter(Boolean).join('\n'), allowedMentions: { parse: [] } });
}

// When the IP is already in #request-ip and the crew is set (or changed) afterwards, ping the crew
// members who have not been pinged for this match yet, linking the IP post.
async function pingCrewAboutPostedIp(coverage) {
  if (!coverage?.ipMessageId || !config.requestIpChannelId) return null;
  const already = new Set(coverage.ipPingedUserIds || []);
  const crewIds = crewUserIds(coverage.crew).filter((id) => !already.has(id));
  if (!crewIds.length) return null;
  const channel = await client.channels.fetch(coverage.ipChannelId || config.requestIpChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) return null;
  const ipMessageUrl = `https://discord.com/channels/${channel.guildId}/${channel.id}/${coverage.ipMessageId}`;
  const sent = await channel.send({
    content: buildCrewIpPing({ matchup: coverage.matchup, ipMessageUrl, crewIds }),
    allowedMentions: { parse: [], users: crewIds }
  }).catch(() => null);
  if (!sent) return `⚠️ Could not ping the crew in <#${channel.id}>.`;
  await saveMainStreamCoverage(coverage.matchId, { ipPingedUserIds: [...already, ...crewIds] });
  return `🔌 Pinged the crew in <#${channel.id}> about the connection details.`;
}

// DMs crew members who have not been DMed for this match yet. Returns a line for the staff reply.
async function dmNewCrewMembers(coverage, { postUrl = null, scheduleIso = null } = {}) {
  const crewIds = crewUserIds(coverage.crew || {});
  // Posts made before crew DMs existed fall back to who was pinged, so nobody gets a late DM.
  const already = new Set(coverage.crewDmedUserIds || coverage.schedulePingedUserIds || []);
  const toDm = crewIds.filter((id) => !already.has(id));
  if (!toDm.length) return null;
  const failed = [];
  for (const userId of toDm) {
    const user = await client.users.fetch(userId).catch(() => null);
    const sent = Boolean(user && await user.send({
      content: buildCrewDm({
        matchup: coverage.matchup,
        roles: crewRolesFor(coverage.crew, userId),
        scheduleIso,
        streamUrl: mainStreamUrlFor(coverage),
        faceitUrl: coverage.faceitUrl,
        postUrl
      }) + "\n\nCan't make it? Press the button below and staff will be told right away.",
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`crew_drop:${coverage.matchId}`).setLabel("Can't make it").setStyle(ButtonStyle.Danger)
      )]
    }).then(() => true).catch(() => false));
    if (!sent) failed.push(userId);
  }
  await saveMainStreamCoverage(coverage.matchId, { crewDmedUserIds: [...already, ...toDm] });
  await appendAuditLog({ type: 'main_stream_crew_dmed', matchId: coverage.matchId, userIds: toDm, failedUserIds: failed }).catch(() => null);
  const sentCount = toDm.length - failed.length;
  return [
    sentCount ? `📨 DMed ${sentCount} crew member(s).` : null,
    failed.length ? `⚠️ Could not DM ${failed.map((id) => `<@${id}>`).join(' ')} (DMs closed), so tell them another way.` : null
  ].filter(Boolean).join(' ');
}

// DMs people taken off the crew, but only those who were told they were on it (DMed or pinged).
// They are also forgotten as notified, so being added back sends a fresh DM.
async function dmRemovedCrewMembers(matchId, previousCrew) {
  const coverage = await getMainStreamCoverage(matchId);
  if (!coverage) return null;
  const notified = new Set(coverage.crewDmedUserIds || coverage.schedulePingedUserIds || []);
  const removed = removedCrewIds(previousCrew || {}, coverage.crew || {}).filter((id) => notified.has(id));
  if (!removed.length) return null;
  const scheduleIso = await approvedScheduleIso(matchId);
  const failed = [];
  for (const userId of removed) {
    const user = await client.users.fetch(userId).catch(() => null);
    const sent = Boolean(user && await user.send({
      content: buildCrewRemovedDm({ matchup: coverage.matchup, roles: crewRolesFor(previousCrew, userId), scheduleIso })
    }).then(() => true).catch(() => false));
    if (!sent) failed.push(userId);
  }
  const forget = (ids) => (ids || []).filter((id) => !removed.includes(id));
  await saveMainStreamCoverage(matchId, {
    crewDmedUserIds: forget(coverage.crewDmedUserIds || coverage.schedulePingedUserIds),
    schedulePingedUserIds: forget(coverage.schedulePingedUserIds),
    ipPingedUserIds: forget(coverage.ipPingedUserIds)
  });
  await appendAuditLog({ type: 'main_stream_crew_removed_dmed', matchId, userIds: removed, failedUserIds: failed }).catch(() => null);
  const sentCount = removed.length - failed.length;
  return [
    sentCount ? `📨 Let ${sentCount} removed crew member(s) know by DM.` : null,
    failed.length ? `⚠️ Could not DM ${failed.map((id) => `<@${id}>`).join(' ')} that they were taken off (DMs closed).` : null
  ].filter(Boolean).join(' ');
}

// Posts the schedule message, or edits the one already posted for this match.
async function publishMainStreamSchedulePost(coverage) {
  const channelId = config.productionScheduleChannelId;
  if (!channelId) return { ok: false, line: '⚠️ Crew saved, but no schedule channel is set (`PRODUCTION_SCHEDULE_CHANNEL_ID`).' };
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return { ok: false, line: `⚠️ Crew saved, but I can't post in <#${channelId}>.` };
  const scheduleIso = await approvedScheduleIso(coverage.matchId);
  const content = buildMainStreamSchedulePost({
    teamA: coverage.teamA,
    teamB: coverage.teamB,
    matchup: coverage.matchup,
    faceitUrl: coverage.faceitUrl,
    scheduleIso,
    crew: coverage.crew,
    streamUrl: mainStreamUrlFor(coverage)
  });
  const pings = { parse: [], users: crewUserIds(coverage.crew) };
  try {
    const existing = coverage.scheduleMessageId && coverage.scheduleChannelId === channel.id
      ? await channel.messages.fetch(coverage.scheduleMessageId).catch(() => null)
      : null;
    if (existing) {
      await existing.edit({ content, allowedMentions: { parse: [] } });
      // Editing a message never notifies anyone, so people added since the last ping get a short ping.
      const pinged = new Set(coverage.schedulePingedUserIds || crewUserIds(coverage.crew));
      const added = crewUserIds(coverage.crew).filter((id) => !pinged.has(id));
      if (added.length) {
        await channel.send({
          content: `🎬 ${added.map((id) => `<@${id}>`).join(' ')}: you're on the crew for **${coverage.matchup}**: ${existing.url}`,
          allowedMentions: { parse: [], users: added }
        }).catch(() => null);
      }
      const updated = await saveMainStreamCoverage(coverage.matchId, { schedulePingedUserIds: [...pinged, ...added] });
      const dmLine = await dmNewCrewMembers(updated, { postUrl: existing.url, scheduleIso });
      return { ok: true, line: [`✏️ Updated the schedule post in <#${channel.id}>${added.length ? ' and pinged the new crew' : ''}: ${existing.url}`, dmLine].filter(Boolean).join('\n') };
    }
    const message = await channel.send({ content, allowedMentions: pings });
    const posted = await saveMainStreamCoverage(coverage.matchId, { scheduleChannelId: channel.id, scheduleMessageId: message.id, schedulePingedUserIds: crewUserIds(coverage.crew), crewDmedUserIds: coverage.crewDmedUserIds || [] });
    const dmLine = await dmNewCrewMembers(posted, { postUrl: message.url, scheduleIso });
    return { ok: true, line: [`📅 Posted the match in <#${channel.id}> and pinged the crew: ${message.url}`, dmLine].filter(Boolean).join('\n') };
  } catch (error) {
    console.error(`Main stream schedule post failed for ${coverage.matchId}:`, error);
    return { ok: false, line: `⚠️ Crew saved, but posting failed: ${error?.message || error}` };
  }
}

// Marks a posted coverage notice as cancelled (edit in place) and drops a one-line
// follow-up so the teams see it without scrolling. Nothing happens when no notice
// was ever posted. Safe to call twice.
async function cancelCoverageNotice(request, { reason = null, actorId = null } = {}) {
  if (!request?.coverageMessageId || !request?.coverageChannelId || request.coverageCancelledAt) return;
  const remainingCasters = request.matchId
    ? (await listStreamRequests({ matchId: request.matchId, status: 'approved' })).filter((entry) => entry.id !== request.id).length
    : 0;
  const notice = buildCoverageNotice(request, { cancelled: true, reason, remainingCasters });
  try {
    const channel = await client.channels.fetch(request.coverageChannelId).catch(() => null);
    if (!channel?.isTextBased?.()) return;
    const original = await channel.messages.fetch(request.coverageMessageId).catch(() => null);
    if (original) await original.edit({ embeds: [coverageEmbed(notice)], components: [] }).catch(() => null);
    await channel.send({ content: notice.followUp, allowedMentions: { parse: [] } }).catch(() => null);
    await updateStreamRequest(request.id, { coverageCancelledAt: new Date().toISOString() });
    await appendAuditLog({ type: 'stream_coverage_cancelled', matchId: request.matchId, requestId: request.id, actorId, remainingCasters }).catch(() => null);
  } catch (error) {
    console.error(`Coverage cancellation notice failed for stream request ${request.id}:`, error);
  }
}

// --- "Live now" board ---------------------------------------------------------
// One message per live broadcast in LIVE_NOW_CHANNEL_ID, deleted when it ends, so
// the channel reads as a board of who is broadcasting right now. v1 is driven by the
// caster's "Going live" / "End broadcast" buttons; platform detection can replace
// startBroadcast/endBroadcast later without touching the rest.

function liveBoardEmbed(request) {
  const notice = buildLiveBoardNotice(request);
  return new EmbedBuilder()
    .setColor(notice.color)
    .setTitle(notice.title)
    .setDescription(notice.description)
    .addFields(notice.fields)
    .setFooter({ text: notice.footer })
    .setTimestamp();
}

async function fetchLiveBoardChannel() {
  if (!config.liveNowChannelId) return null;
  const channel = await client.channels.fetch(config.liveNowChannelId).catch(() => null);
  return channel?.isTextBased?.() ? channel : null;
}

// Posts (or, if a board message already exists, edits) the request's board message.
async function startBroadcast(request, { actorId = null } = {}) {
  if (request.status !== 'approved') return { ok: false, error: 'Only an approved cast can go live.' };
  const channel = await fetchLiveBoardChannel();
  if (!channel) return { ok: false, error: 'The live board channel is not configured or not reachable.' };
  const startedAt = request.liveStartedAt && !request.liveEndedAt ? request.liveStartedAt : new Date().toISOString();
  const draft = { ...request, liveStartedAt: startedAt, liveEndedAt: null };
  const payload = { embeds: [liveBoardEmbed(draft)], allowedMentions: { parse: [] } };
  let message = request.liveMessageId && !request.liveEndedAt
    ? await channel.messages.fetch(request.liveMessageId).catch(() => null)
    : null;
  try {
    message = message ? await message.edit(payload) : await channel.send(payload);
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
  const updated = await updateStreamRequest(request.id, {
    liveStartedAt: startedAt, liveEndedAt: null, liveChannelId: channel.id, liveMessageId: message.id
  }, ['approved']);
  if (!updated) {
    await message.delete().catch(() => null);
    return { ok: false, error: 'The request changed while going live. Check its status.' };
  }
  await appendAuditLog({ type: 'stream_live_started', actorId, matchId: request.matchId, requestId: request.id, messageId: message.id }).catch(() => null);
  return { ok: true, request: updated };
}

// Removes the board message and closes the live window. Safe when nothing is live.
async function endBroadcast(request, { actorId = null, reason = 'ended' } = {}) {
  if (!isBroadcastLive(request)) return { ok: true, request };
  if (request.liveChannelId && request.liveMessageId) {
    const channel = await client.channels.fetch(request.liveChannelId).catch(() => null);
    const message = channel?.isTextBased?.() ? await channel.messages.fetch(request.liveMessageId).catch(() => null) : null;
    await message?.delete().catch(() => null);
  }
  const updated = await updateStreamRequest(request.id, { liveEndedAt: new Date().toISOString() });
  await appendAuditLog({ type: 'stream_live_ended', actorId, matchId: request.matchId, requestId: request.id, reason }).catch(() => null);
  return { ok: true, request: updated || request };
}

// Edit, don't repost, when match details change under a live broadcast.
async function refreshLiveBoardMessage(request) {
  if (!isBroadcastLive(request) || !request.liveChannelId || !request.liveMessageId) return;
  const channel = await client.channels.fetch(request.liveChannelId).catch(() => null);
  const message = channel?.isTextBased?.() ? await channel.messages.fetch(request.liveMessageId).catch(() => null) : null;
  await message?.edit({ embeds: [liveBoardEmbed(request)], allowedMentions: { parse: [] } }).catch(() => null);
}

// After a restart: every live request has exactly one board message, and the board
// holds nothing else of ours. Stranded messages are deleted; missing ones re-posted.
async function resyncLiveBoard() {
  const channel = await fetchLiveBoardChannel();
  if (!channel) return;
  const live = (await listStreamRequests()).filter(isBroadcastLive);
  const keep = new Set();
  for (const request of live) {
    const existing = request.liveMessageId ? await channel.messages.fetch(request.liveMessageId).catch(() => null) : null;
    if (existing) {
      await existing.edit({ embeds: [liveBoardEmbed(request)], allowedMentions: { parse: [] } }).catch(() => null);
      keep.add(existing.id);
      continue;
    }
    const message = await channel.send({ embeds: [liveBoardEmbed(request)], allowedMentions: { parse: [] } }).catch(() => null);
    if (!message) continue;
    await updateStreamRequest(request.id, { liveChannelId: channel.id, liveMessageId: message.id });
    keep.add(message.id);
    console.warn(`Live board: re-posted missing message for request ${request.id}`);
  }
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  for (const message of recent?.values() || []) {
    if (message.author?.id !== client.user.id || keep.has(message.id)) continue;
    await message.delete().catch(() => null);
    console.warn(`Live board: removed stranded message ${message.id}`);
  }
  console.log(`Live board: ${live.length} live broadcast(s) synced to <#${channel.id}>`);
}

// Stale guard, run every operations tick.
async function autoEndStaleBroadcasts(now = Date.now()) {
  const at = new Date(now);
  for (const request of await listStreamRequests()) {
    if (!shouldAutoEndBroadcast(request, at)) continue;
    await endBroadcast(request, { reason: 'auto' });
    console.warn(`Live board: auto-ended broadcast for request ${request.id} (${request.matchup})`);
  }
}

function streamCasterLiveButton(request) {
  const live = isBroadcastLive(request);
  return new ButtonBuilder()
    .setCustomId(`stream_live:${live ? 'end' : 'start'}:${request.id}:${request.requesterId}`)
    .setLabel(live ? 'End broadcast' : 'Going live')
    .setEmoji(live ? '⏹️' : '🔴')
    .setStyle(live ? ButtonStyle.Secondary : ButtonStyle.Success);
}

async function handleStreamLiveButton(interaction) {
  const [, action, requestId, requesterId] = interaction.customId.split(':');
  if (interaction.user.id !== requesterId) {
    await interaction.reply({ content: 'Only the caster of this request can mark it live.', ephemeral: true });
    return;
  }
  const request = await getStreamRequest(requestId);
  if (!request || request.status !== 'approved') {
    await interaction.reply({ content: 'This cast is no longer approved, so it cannot be marked live.', ephemeral: true });
    return;
  }
  const result = action === 'start'
    ? await startBroadcast(request, { actorId: interaction.user.id })
    : await endBroadcast(request, { actorId: interaction.user.id, reason: 'caster' });
  if (!result.ok) {
    await interaction.reply({ content: `⚠️ ${result.error}`, ephemeral: true });
    return;
  }
  await interaction.update({ components: [streamCasterWithdrawRow(result.request, { live: true })] }).catch(() => null);
  await interaction.followUp({
    content: action === 'start'
      ? `🔴 You are on the live board${config.liveNowChannelId ? ` in <#${config.liveNowChannelId}>` : ''}. Press **End broadcast** when you go offline.`
      : '⏹️ Broadcast ended and removed from the live board. Press **Going live** again if you come back.',
    ephemeral: true
  }).catch(() => null);
}

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
  await cancelCoverageNotice(updated, { reason: 'Staff revoked the approval.', actorId });
  await endBroadcast(updated, { actorId, reason: 'revoked' });
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

async function notifyStreamRequester(request, text, { staffFallback = true } = {}) {
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
  if (!staffFallback) return false;
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
  const channel = ipChannelId()
    ? await client.channels.fetch(ipChannelId()).catch(() => null)
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
  const label = type === 'cstv' ? 'Server IP:PORT' : 'CROSSFIRE Twitch link';
  const modal = new ModalBuilder()
    .setCustomId(`stream_delivery_submit:${type}:${matchId}`)
    .setTitle(type === 'cstv' ? 'Submit CSTV Connect' : 'Submit Twitch Link')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('delivery')
        .setLabel(label)
        .setPlaceholder(type === 'cstv' ? '66.206.17.130:27035' : 'Example: https://twitch.tv/crossfire')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ));
  if (type === 'cstv') {
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('use_password')
        .setLabel('Add the season password? (Yes/No)')
        .setValue('Yes')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(5)
        .setRequired(false)
    ));
  }
  await interaction.showModal(modal);
}

async function handleStreamDeliverySubmit(interaction) {
  if (!canManageStreamRequests(interaction.member)) {
    await interaction.reply({ content: 'Only authorized staff can submit caster connection details.', ephemeral: true });
    return;
  }
  const [, type, matchId] = interaction.customId.split(':');
  const raw = interaction.fields.getTextInputValue('delivery');
  const delivery = type === 'cstv'
    ? buildCstvConnect(raw, { password: activeSeason()?.cstvPassword || null, usePassword: wantsSeasonPassword(modalFieldValue(interaction, 'use_password') ?? 'Yes') })
    : validateStreamDelivery(type, raw);
  if (!delivery.valid) {
    await interaction.reply({ content: delivery.error, ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const result = await deliverStreamConnection(matchId, type, delivery.value, interaction.user.id);
  await interaction.message?.edit({ components: [] }).catch(() => null);
  await interaction.editReply([
    `Sent the ${type === 'cstv' ? 'CSTV connect' : 'Twitch link'} to ${result.delivered}/${result.casterCount} approved caster(s).`,
    result.requestIpPosted ? `Posted in <#${config.requestIpChannelId}>.` : null,
    cstvPasswordNote(delivery),
    failedDmLine(result.failedCasterIds)
  ].filter(Boolean).join(' '));
}

// Reads an optional modal field without throwing when an older form did not have it.
function modalFieldValue(interaction, customId) {
  try {
    return interaction.fields.getTextInputValue(customId);
  } catch {
    return null;
  }
}

// Tells staff whether the season password went on the line, without showing it.
function cstvPasswordNote(delivery) {
  if (!delivery?.address) return null;
  if (delivery.passwordAdded) return 'Season password added.';
  if (delivery.passwordMissing) return 'No CSTV password is set for this season, so it went without one (`/cf season action:set CSTV password`).';
  return 'Sent without the password.';
}

// DMs the connection details to every caster approved for the match: one DM per
// caster, including casters whose FACEIT link could not be verified at submit time
// and casters whose website publish is still failing.
async function deliverStreamConnection(matchId, type, value, actorId) {
  const { requests, recipients } = selectConnectionRecipients(await listStreamRequests(), matchId);
  let delivered = 0;
  const deliveryByCaster = new Map();
  for (const request of recipients) {
    const sent = await dmStreamRequester(request, buildConnectionDm({ matchup: request.matchup, type, value }));
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
    }, STREAM_CONNECTION_STATUSES);
  }
  const failedCasterIds = [...deliveryByCaster].filter(([, sent]) => !sent).map(([casterId]) => casterId);
  await appendAuditLog({ type: 'stream_connection_delivered', actorId, matchId, delivered, requestCount: requests.length, failedCasterIds });
  // The official Twitch link is not connection details, so only CSTV/custom go to #request-ip.
  let requestIpPosted = false;
  if (type !== 'twitch') {
    await saveMatchConnection(matchId, { type, value, sentAt: new Date().toISOString(), sentBy: actorId });
    requestIpPosted = await postConnectionToRequestIp(matchId, { requests, delivered, casterCount: deliveryByCaster.size }).catch(() => false);
  }
  return { delivered, casterCount: deliveryByCaster.size, requests, requestIpPosted, failedCasterIds };
}

async function disableStreamDeliveryPrompts(requests) {
  const messageIds = [...new Set(requests.map((request) => request.deliveryPromptMessageId).filter(Boolean))];
  if (!messageIds.length || !ipChannelId()) return;
  const channel = await client.channels.fetch(ipChannelId()).catch(() => null);
  for (const messageId of messageIds) {
    const message = await channel?.messages.fetch(messageId).catch(() => null);
    await message?.edit({ components: [] }).catch(() => null);
  }
}

// --- Main stream (official broadcast) ------------------------------------------
// `/cf mainstream match:<link>` (or inside a match channel, no link) marks a match
// as covered by the official broadcast. The bot cannot read the server IP from FACEIT,
// so it forwards whatever staff enter through the usual connection prompt or !sendip:
// already entered -> posted to REQUEST_IP_CHANNEL_ID now; not yet -> posted the moment
// it is entered.

// Puts a match on the main stream: teams' notice, sheet link and colour, and the IP in #request-ip
// (now if entered, or as soon as it is). Returns the saved coverage and lines for the staff reply.
async function startMainStreamCoverage({ matchId, faceitUrl: givenUrl = null, stored = null, actorId }) {
  const match = stored?.match || await faceit.getMatch(matchId).catch(() => null);
  const matchup = match?.teamA && match?.teamB ? `${match.teamA} vs ${match.teamB}` : 'FACEIT match';
  const faceitUrl = givenUrl || match?.faceitUrl || `https://www.faceit.com/en/cs2/room/${matchId}`;
  const coverage = await saveMainStreamCoverage(matchId, {
    matchup,
    teamA: match?.teamA || null,
    teamB: match?.teamB || null,
    faceitUrl,
    faceitScheduledAtIso: getFaceitScheduledAtIso(match),
    requestedBy: actorId,
    requestedAt: new Date().toISOString()
  });
  await appendAuditLog({ type: 'main_stream_requested', actorId, matchId });
  const lines = [];
  const connection = await getMatchConnection(matchId);
  if (connection?.value) {
    const posted = await postConnectionToRequestIp(matchId);
    lines.push(posted
      ? `📺 **${matchup}** is on the main stream. Posted the connection details in <#${config.requestIpChannelId}>.`
      : `📺 **${matchup}** is on the main stream. ⚠️ Could not post in <#${config.requestIpChannelId}>; check that I can view and send messages there.`);
  } else {
    const casterCount = (await listStreamRequests({ matchId, status: 'approved' })).length;
    lines.push(`📺 **${matchup}** is on the main stream. No IP has been entered for it yet.`);
    lines.push(casterCount
      ? 'Staff get the usual connection prompt at match time for the approved casters.'
      : `Staff will be asked for it in <#${ipChannelId()}> at match time, like the caster prompt. To send it sooner: \`!sendip FACEIT_MATCHROOM_LINK connect IP:PORT\`.`);
    lines.push(`It will be posted in <#${config.requestIpChannelId}> as soon as it is entered.`);
  }
  lines.push(await postMainStreamCoverageNotice(coverage, { stored }));
  return { coverage, lines };
}

// `/cf mainstream`: start main stream coverage, or update the stream and crew of a match that is
// already on it (only the crew roles given change), or take it off with remove:True.
async function handleMainStreamCommand(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const link = interaction.options.getString('match');
  const parsed = link ? parseFaceitMatchRoomLink(link) : null;
  if (link && !parsed) {
    await interaction.editReply('That is not a FACEIT matchroom link. Paste the full room link, or run the command inside the match channel without `match:`.');
    return;
  }
  const channelMatch = parsed ? null : await getStoredMatchByChannel(interaction.channelId);
  const matchId = parsed?.matchId || channelMatch?.match?.id || null;
  if (!matchId) {
    await interaction.editReply('Give `match:` (the FACEIT matchroom link), or run the command inside the match channel.');
    return;
  }
  const actorId = interaction.user.id;
  let coverage = await getMainStreamCoverage(matchId);

  if (interaction.options.getBoolean('remove')) {
    if (!coverage) {
      await interaction.editReply('That match is not on the main stream.');
      return;
    }
    const lines = await removeMainStreamCoverage(coverage, actorId);
    await interaction.editReply({ content: lines.filter(Boolean).join('\n'), allowedMentions: { parse: [] } });
    return;
  }

  const lines = [];
  if (!coverage) {
    if (!config.requestIpChannelId) {
      await interaction.editReply('Main stream IP posting is off: `REQUEST_IP_CHANNEL_ID` is not set.');
      return;
    }
    const started = await startMainStreamCoverage({
      matchId, faceitUrl: parsed?.url || null, stored: channelMatch || await getStoredMatch(matchId), actorId
    });
    coverage = started.coverage;
    lines.push(...started.lines);
  } else {
    lines.push(`📺 **${coverage.matchup}** is already on the main stream.`);
  }

  // Stream
  const streamOption = interaction.options.getString('stream');
  let streamChanged = false;
  if (streamOption) {
    if (!config.mainStreamUrls.includes(streamOption)) {
      lines.push(`⚠️ \`${streamOption}\` is not one of the CROSSFIRE streams, so the stream was not changed. Pick one from the list.`);
    } else if (streamOption !== mainStreamUrlFor(coverage)) {
      coverage = await saveMainStreamCoverage(matchId, { streamUrl: streamOption });
      streamChanged = true;
      lines.push(`📺 Stream: ${streamOption}`);
    }
  }
  const sheetLine = await syncMainStreamSheetLink(coverage, actorId);
  if (sheetLine) lines.push(sheetLine);
  if (streamChanged) await refreshMainStreamCoverageNotice(coverage);

  // Crew: only the roles given change.
  // Each crew option is a suggestion (user ID), an @mention or a name.
  const crewOptions = {};
  for (const key of ['caster1', 'caster2', 'producer', 'observer', 'admin', 'social']) {
    const resolved = await resolveCrewInput(interaction.options.getString(key));
    crewOptions[key] = resolved.id;
    if (resolved.error) lines.push(resolved.error);
  }
  const crewGiven = Object.values(crewOptions).some(Boolean);
  let previousCrew = null;
  if (crewGiven) {
    previousCrew = coverage.crew || {};
    const crew = mergeCrewOptions(previousCrew, crewOptions);
    coverage = await saveMainStreamCoverage(matchId, { crew, crewSetBy: actorId, crewSetAt: new Date().toISOString() });
    await appendAuditLog({ type: 'main_stream_crew_set', actorId, matchId, crew }).catch(() => null);
    lines.push(...await crewAvailabilityWarnings(matchId, Object.values(crewOptions).filter(Boolean)).catch(() => []));
  }
  const crewReady = Boolean(coverage.crew?.casters?.length && coverage.crew?.producer);
  if (crewReady && (crewGiven || (streamChanged && coverage.scheduleMessageId))) {
    const result = await publishMainStreamSchedulePost(coverage);
    lines.push(result.line);
    if (previousCrew) {
      const removedLine = await dmRemovedCrewMembers(matchId, previousCrew);
      if (removedLine) lines.push(removedLine);
    }
    coverage = await getMainStreamCoverage(matchId) || coverage;
    const ipLine = await pingCrewAboutPostedIp(coverage);
    if (ipLine) lines.push(ipLine);
  } else if (crewGiven) {
    lines.push('🎬 Crew saved. Add `caster1:` and `producer:` to post it in the Schedule channel.');
  } else if (!coverage.scheduleMessageId) {
    lines.push('🎬 No crew yet: run this again with `caster1:` and `producer:` (plus any others), or use the button below.');
  }

  await interaction.editReply({
    content: lines.filter(Boolean).join('\n').slice(0, 2000),
    components: mainStreamControls(coverage),
    allowedMentions: { parse: [] }
  });
}

// Takes a match off the main stream and undoes what was posted for it. Returns staff reply lines.
async function removeMainStreamCoverage(coverage, actorId) {
  const lines = [`🗑️ **${coverage.matchup}** is off the main stream.`];
  const matchId = coverage.matchId;
  await deleteMainStreamCoverage(matchId);
  await appendAuditLog({ type: 'main_stream_removed', actorId, matchId }).catch(() => null);
  const communityCasters = (await listStreamRequests({ matchId })).filter((request) => STREAM_CONNECTION_STATUSES.includes(request.status)).length;
  const crewIds = crewUserIds(coverage.crew || {});

  // Teams' notice
  if (coverage.noticeMessageId && coverage.noticeChannelId) {
    const channel = await client.channels.fetch(coverage.noticeChannelId).catch(() => null);
    const message = channel?.isTextBased?.() ? await channel.messages.fetch(coverage.noticeMessageId).catch(() => null) : null;
    if (message) {
      await message.edit({ embeds: [coverageEmbed(buildMainStreamCancelledNotice({ matchup: coverage.matchup, communityCasters }))] }).catch(() => null);
      await channel.send({ content: `📺 **${coverage.matchup}** is no longer on the main stream.`, allowedMentions: { parse: [] } }).catch(() => null);
      lines.push(`Told the teams in <#${channel.id}>.`);
    }
  }

  // Schedule channel post
  if (coverage.scheduleMessageId && coverage.scheduleChannelId) {
    const channel = await client.channels.fetch(coverage.scheduleChannelId).catch(() => null);
    const message = channel?.isTextBased?.() ? await channel.messages.fetch(coverage.scheduleMessageId).catch(() => null) : null;
    if (message) {
      // Delete the original post. If the bot can't (missing permission), mark it cancelled instead.
      const deleted = await message.delete().then(() => true).catch(() => false);
      if (!deleted) {
        const original = message.content.replace(/^❌ \*\*CANCELLED: no longer on the main stream\*\*\n\n/, '');
        await message.edit({ content: `❌ **CANCELLED: no longer on the main stream**\n\n${original}`.slice(0, 2000), allowedMentions: { parse: [] } }).catch(() => null);
      }
      if (crewIds.length) {
        await channel.send({
          content: `❌ ${crewIds.map((id) => `<@${id}>`).join(' ')}: **${coverage.matchup}** is no longer on the main stream.${deleted ? '' : ` ${message.url}`}`,
          allowedMentions: { parse: [], users: crewIds }
        }).catch(() => null);
      }
      lines.push(`${deleted ? 'Deleted the Schedule post' : "Couldn't delete the Schedule post, so marked it cancelled"}${crewIds.length ? ' and pinged the crew' : ''}.`);
    }
  }

  // #request-ip
  if (coverage.ipMessageId && config.requestIpChannelId) {
    const channel = await client.channels.fetch(coverage.ipChannelId || config.requestIpChannelId).catch(() => null);
    if (channel?.isTextBased?.()) {
      await channel.send({ content: `📺 **MAIN STREAM CANCELLED: ${coverage.matchup}**. Ignore the connection details posted for it.`, allowedMentions: { parse: [] } }).catch(() => null);
    }
  }

  // Google Sheet: take the main stream link off and recolour the row.
  if (coverage.sheetStreamUrl && parseFaceitMatchRoomLink(coverage.faceitUrl)) {
    const highlight = communityCasters ? 'community' : 'none';
    const result = await scheduleSheet.removeStreamLink(buildMainStreamSheetRow(coverage, { streamUrl: coverage.sheetStreamUrl, highlight, actorId })).catch((error) => ({ ok: false, error: error?.message || String(error) }));
    lines.push(result.ok ? `📄 Took ${coverage.sheetStreamUrl} off the Google Sheet row.` : `⚠️ The Google Sheet still has ${coverage.sheetStreamUrl}: ${result.error}`);
  }
  return lines;
}

async function handleMainStreamAutocomplete(interaction) {
  if (!canManageStreamRequests(interaction.member)) {
    await interaction.respond([]).catch(() => null);
    return;
  }
  const focusedOption = interaction.options.getFocused(true);
  if (focusedOption.name !== 'stream') {
    await interaction.respond(await crewAutocompleteChoices(interaction, focusedOption).catch(() => [])).catch(() => null);
    return;
  }
  const focused = String(focusedOption.value || '').toLowerCase();
  await interaction.respond(config.mainStreamUrls
    .filter((url) => !focused || url.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((url) => ({ name: (streamChannelName(url) || url).slice(0, 100), value: url })))
    .catch(() => null);
}

// At match time (like the caster prompt), asks staff for the main stream's connection details,
// once per match. Skipped when the details are already in, or when approved community casters
// have the match (their prompt goes out instead and the details reach #request-ip from it).
const MAIN_STREAM_PROMPT_WINDOW_MS = 12 * 60 * 60 * 1000;

async function sendDueMainStreamPrompts(now = Date.now()) {
  for (const coverage of await listMainStreamCoverage()) {
    if (!coverage?.matchId || coverage.deliveryPromptSentAt) continue;
    const startIso = await approvedScheduleIso(coverage.matchId) || coverage.faceitScheduledAtIso || null;
    const startMs = Date.parse(startIso || '');
    if (!Number.isFinite(startMs) || startMs > now || now - startMs > MAIN_STREAM_PROMPT_WINDOW_MS) continue;
    if ((await getMatchConnection(coverage.matchId))?.value) continue;
    if ((await listStreamRequests({ matchId: coverage.matchId, status: 'approved' })).length) continue;
    const claimed = await claimMainStreamDeliveryPrompt(coverage.matchId);
    if (claimed) await sendMainStreamDeliveryPrompt(claimed);
  }
}

async function sendMainStreamDeliveryPrompt(coverage) {
  const channel = ipChannelId()
    ? await client.channels.fetch(ipChannelId()).catch(() => null)
    : null;
  if (!channel?.isTextBased?.()) return false;
  return channel.send({
    content: getStaffMentions(channel.guild),
    embeds: [new EmbedBuilder()
      .setColor(EMBED_COLORS.warning)
      .setTitle('Main Stream Connection Needed')
      .setDescription(`The main stream is covering **${coverage.matchup}**. Submit the CSTV connect command or server IP when it is available. It will be posted in <#${config.requestIpChannelId}>.`)
      .addFields({ name: 'FACEIT Matchroom', value: coverage.faceitUrl })
      .setTimestamp()],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`stream_delivery_open:cstv:${coverage.matchId}`).setLabel('Submit CSTV Connect').setStyle(ButtonStyle.Primary)
    )],
    allowedMentions: getAdminAllowedMentions(channel.guild)
  }).then(() => true).catch(() => false);
}

// The channel that holds IP prompts and posted IPs: #request-ip when configured,
// otherwise the staff review channel as before.
function ipChannelId() {
  return config.requestIpChannelId || config.streamRequestChannelId || null;
}

// Posts the match's latest connection details to #request-ip. Used for every IP
// staff enter (any match) and when `/cf mainstream` finds one already entered.
async function postConnectionToRequestIp(matchId, { requests = [], delivered = 0, casterCount = 0 } = {}) {
  if (!config.requestIpChannelId) return false;
  const connection = await getMatchConnection(matchId);
  if (!connection?.value) return false;
  const coverage = await getMainStreamCoverage(matchId);
  const stored = coverage ? null : await getStoredMatch(matchId);
  const matchup = coverage?.matchup || requests[0]?.matchup
    || (stored?.match?.teamA && stored?.match?.teamB ? `${stored.match.teamA} vs ${stored.match.teamB}` : 'FACEIT match');
  const faceitUrl = coverage?.faceitUrl || requests[0]?.faceitUrl || stored?.match?.faceitUrl || `https://www.faceit.com/en/cs2/room/${matchId}`;
  const channel = await client.channels.fetch(config.requestIpChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;
  // Main stream: ping the production crew so they see the connection details.
  const crewIds = coverage?.crew ? crewUserIds(coverage.crew) : [];
  const message = await channel.send({
    content: buildRequestIpMessage({
      matchup, faceitUrl, value: connection.value, enteredBy: connection.sentBy,
      mainStream: Boolean(coverage), casterCount, delivered, crewIds
    }),
    allowedMentions: { parse: [], users: crewIds }
  }).catch(() => null);
  if (!message) return false;
  if (coverage) {
    await saveMainStreamCoverage(matchId, {
      ipPostedAt: new Date().toISOString(),
      ipMessageId: message.id,
      ipChannelId: channel.id,
      ipPingedUserIds: [...new Set([...(coverage.ipPingedUserIds || []), ...crewIds])]
    });
  }
  // The connection value itself is never written to the audit log.
  await appendAuditLog({ type: 'request_ip_posted', matchId, messageId: message.id, mainStream: Boolean(coverage) }).catch(() => null);
  return true;
}

function failedDmLine(casterIds) {
  return casterIds?.length
    ? `⚠️ Could not DM ${casterIds.map((id) => `<@${id}>`).join(', ')} (DMs closed or bot blocked). Send it to them another way.`
    : null;
}

// A caster approved after the IP already went out gets the saved details right away.
async function sendSavedConnectionToNewCaster(request) {
  const roomId = requestRoomId(request);
  if (!roomId || request.deliverySentAt || request.terminalNotifiedAt) return null;
  const connection = await getMatchConnection(roomId);
  if (!connection?.value) return null;
  const sent = await dmStreamRequester(request, buildConnectionDm({ matchup: request.matchup, type: connection.type, value: connection.value }));
  await updateStreamRequest(request.id, {
    deliveryType: connection.type,
    deliverySentAt: new Date().toISOString(),
    deliverySentBy: connection.sentBy || null,
    deliveryStatus: sent ? 'delivered' : 'failed'
  }, STREAM_CONNECTION_STATUSES);
  await appendAuditLog({ type: 'stream_connection_delivered', matchId: roomId, requestId: request.id, delivered: sent ? 1 : 0, requestCount: 1, late: true }).catch(() => null);
  return sent
    ? 'The connection details for this match were already entered, so they were DMed to the caster now.'
    : '⚠️ The connection details for this match were already entered, but I could not DM them to the caster.';
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
  if (parsed && !deliveryText) {
    const sent = await sendStreamDeliveryPrompt(parsed.matchId, true);
    await message.reply(sent
      ? `Reposted the IP prompt${config.requestIpChannelId || config.streamRequestChannelId ? ` in <#${ipChannelId()}>` : ''}.`
      : 'No approved caster requests were found for that FACEIT matchroom.');
    return;
  }
  // `nopw` at the end sends the address without the season password.
  const noPassword = /(^|\s)nopw\s*$/i.test(deliveryText);
  const delivery = buildCstvConnect(deliveryText.replace(/(^|\s+)nopw\s*$/i, ''), {
    password: activeSeason()?.cstvPassword || null,
    usePassword: !noPassword
  });
  if (!parsed || !delivery.valid) {
    await message.reply(`Use \`!sendip FACEIT_MATCHROOM_LINK IP:PORT\` to send details now, for example \`!sendip https://www.faceit.com/en/cs2/room/1-... 123.45.67.89:27020\`. The season password is added; put \`nopw\` at the end to leave it off. \`!sendip FACEIT_MATCHROOM_LINK\` alone reposts the IP prompt.${parsed && !delivery.valid ? `\n${delivery.error}` : ''}`);
    return;
  }
  await message.delete().catch(() => null);
  const result = await deliverStreamConnection(parsed.matchId, delivery.address ? 'cstv' : 'custom', delivery.value, message.author.id);
  const passwordNote = cstvPasswordNote(delivery);
  const postedLine = `${result.requestIpPosted ? ` Posted in <#${config.requestIpChannelId}>.` : ''}${passwordNote ? ` ${passwordNote}` : ''}`;
  if (!result.requests.length) {
    await message.channel.send(result.requestIpPosted
      ? `No approved casters for that FACEIT matchroom.${postedLine}`
      : 'No approved caster requests were found for that FACEIT matchroom. The details were saved and will post if `/cf mainstream` is used for it.').catch(() => null);
    return;
  }
  await disableStreamDeliveryPrompts(result.requests);
  await message.channel.send({
    content: [`Sent the connection details to ${result.delivered}/${result.casterCount} approved caster(s).${postedLine}`, failedDmLine(result.failedCasterIds)].filter(Boolean).join(' '),
    allowedMentions: { parse: [] }
  }).catch(() => null);
}

async function handleAdminStreams(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const action = interaction.options.getString('action', true);
  const requestId = interaction.options.getString('request_id')?.trim() || null;
  if (action === 'list') {
    const view = buildStreamListView(await listStreamRequests());
    const buttons = view.retryIds.map((id) => new ButtonBuilder()
      .setCustomId(`stream_retry:${id}`)
      .setLabel(`Retry ${id}`.slice(0, 80))
      .setStyle(ButtonStyle.Secondary));
    const rows = [];
    for (let index = 0; index < buttons.length; index += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(index, index + 5)));
    const embed = new EmbedBuilder().setTitle('🎙️ Stream requests').setDescription(view.description).setColor(0x9146ff);
    await interaction.editReply({ embeds: [embed], components: rows, allowedMentions: { parse: [] } });
    return;
  }
  if (action === 'inspect') {
    const request = requestId ? await getStreamRequest(requestId) : null;
    await interaction.editReply(request ? { embeds: [streamRequestEmbed(request)] } : 'Give a valid `request_id`. `/cf streams action:list` shows them.');
    return;
  }
  if (action === 'cancel') {
    await staffCancelStreams(interaction, {
      requestId,
      matchLink: interaction.options.getString('match')?.trim() || null,
      caster: interaction.options.getUser('caster'),
      reason: interaction.options.getString('reason')?.trim() || ''
    });
  }
}

// One cancel for everything: a single request, every request on a match, or every active request
// from a caster. Pending and approved requests alike; each caster is told why.
async function staffCancelStreams(interaction, { requestId, matchLink, caster, reason }) {
  const targets = [requestId, matchLink, caster].filter(Boolean).length;
  if (targets !== 1) {
    await interaction.editReply('Give exactly one of `request_id:`, `match:` (FACEIT matchroom link) or `caster:`.');
    return;
  }
  let requests = [];
  let label = '';
  if (requestId) {
    const request = await getStreamRequest(requestId);
    requests = request && STREAM_ACTIVE_STATUSES.includes(request.status) ? [request] : [];
    label = `request ${requestId}`;
  } else if (matchLink) {
    const parsed = parseFaceitMatchRoomLink(matchLink);
    if (!parsed) {
      await interaction.editReply('That is not a FACEIT matchroom link.');
      return;
    }
    requests = (await listStreamRequests()).filter((request) => requestRoomId(request) === parsed.matchId && STREAM_ACTIVE_STATUSES.includes(request.status));
    label = 'that match';
  } else {
    requests = (await listStreamRequests({ requesterId: caster.id })).filter((request) => STREAM_ACTIVE_STATUSES.includes(request.status));
    label = `<@${caster.id}>`;
  }
  const canceled = [];
  for (const request of requests) {
    const updated = await cancelStreamRequestByStaff(request, interaction.user.id, reason || 'Canceled by staff');
    if (updated) canceled.push(updated);
  }
  await interaction.editReply({
    content: canceled.length
      ? `Canceled ${canceled.length} request(s) for ${label}. Each caster was told:\n${canceled.map((request) => `- \`${request.id}\` ${request.matchup} · <@${request.requesterId}>`).join('\n')}`
      : `No active requests found for ${label}.`,
    allowedMentions: { parse: [] }
  });
}

async function cancelStreamRequestByStaff(request, actorId, reason) {
  const updated = await updateStreamRequest(request.id, {
    status: 'canceled',
    canceledBy: actorId,
    canceledAt: new Date().toISOString(),
    denialReason: reason
  }, STREAM_ACTIVE_STATUSES);
  if (!updated) return null;
  await refreshStreamRequestStaffMessage(updated);
  await syncStreamRequestToWebsite(updated, 'canceled');
  await cancelCoverageNotice(updated, { reason: 'Staff canceled the cast.', actorId });
  await endBroadcast(updated, { actorId, reason: 'staff_canceled' });
  const sheetWarning = await removeStreamLinkFromSheet(updated, actorId);
  if (sheetWarning) await alertStreamStaff(`⚠️ ${sheetWarning} (stream request ${updated.id}, ${updated.matchup})`);
  await appendAuditLog({ type: 'stream_request_canceled_by_staff', actorId, matchId: updated.matchId, requestId: updated.id, reason });
  await notifyStreamRequester(updated, `Your CROSSFIRE stream request ${updated.id} for **${updated.matchup}** was canceled by staff. Reason: ${reason}`);
  return updated;
}

// The Retry button on `/cf streams action:list` for an approved cast the website did not accept.
async function handleStreamRetryButton(interaction) {
  if (!canManageStreamRequests(interaction.member)) {
    await interaction.reply({ content: 'Only authorized staff can retry website publishing.', ephemeral: true });
    return;
  }
  const requestId = interaction.customId.slice('stream_retry:'.length);
  await interaction.deferReply({ ephemeral: true });
  const request = await getStreamRequest(requestId);
  if (request?.status !== 'publish_failed') {
    await interaction.editReply(`Request ${requestId} is no longer waiting on the website (${STREAM_STATUS_LABELS[request?.status] || request?.status || 'missing'}).`);
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
}

// Marks one cast's post-cast form received (sent without its request ID, or otherwise handled).
async function markPostCastFormReceived(requestId, actorId, note = null) {
  const now = new Date().toISOString();
  const request = await getStreamRequest(requestId);
  if (!request) return null;
  const updated = await updateStreamRequest(requestId, {
    postCastFormSubmittedAt: request.postCastFormSubmittedAt || now,
    postCastFormWaivedAt: now,
    postCastFormWaivedBy: actorId,
    postCastFormSource: 'staff',
    postCastFormNote: note || request.postCastFormNote || null
  }, ['approved']);
  if (!updated) return null;
  await refreshStreamRequestStaffMessage(updated);
  await appendAuditLog({ type: 'stream_post_cast_form_waived', actorId, matchId: updated.matchId, requestId });
  return updated;
}

async function sendPostCastReminder(matchId, actorId = null) {
  if (!matchId) return;
  for (const request of await listStreamRequests({ matchId, status: 'approved' })) {
    await sendPostCastForm(request, actorId);
  }
}

async function sendPostCastForm(request, actorId = null) {
  const claimed = await claimPostCastReminder(request.id);
  if (!claimed) return false;
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
  await appendAuditLog({ type: 'stream_post_cast_form_sent', actorId, matchId: claimed.matchId || null, requestId: claimed.id, delivered: sent });
  return true;
}

// Replaces the old manual "mark match completed": an approved cast still without the form 12 hours
// after its match time (FACEIT never reported a result, or the link was not trackable) gets it now.
async function sendOverduePostCastForms(now = Date.now()) {
  const overdue = (await listStreamRequests())
    .filter((request) => isPostCastFormOverdue(request, { now, since: config.postCastFormGateSince }))
    .slice(0, 10);
  for (const request of overdue) await sendPostCastForm(request, null);
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
    '`!cancel` - cancel your open proposal before the other team accepts it',
    'Schedules and reschedules must stay inside this match window. Reschedules within 24 hours of match time require admin override.',
    isGroupStageMatch(displayMatch)
      ? scheduleWindow
        ? `Group Stage note: teams may schedule by mutual agreement inside ${formatScheduleWindow(scheduleWindow)}.`
        : `${activeSeason()?.name ? `${activeSeason().name} ` : ''}Group Stage note: the scheduling window is not configured yet; admins must verify proposed times until the dates are announced.`
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

// Round windows come from the current season (`/cf season`), then ROUND_WINDOWS in the environment.
// A season's broad "Playoff Stage" row is the last resort for playoff rounds it does not list.
function seasonRoundForMatch(match) {
  const season = activeSeason();
  if (isGroupStageMatch(match)) {
    const roundNumber = getGroupStageRoundNumber(match);
    return findSeasonRound(season, [roundNumber !== 999 ? `Round ${roundNumber}` : null, 'Group Stage'].filter(Boolean));
  }
  return findSeasonRound(season, [match?.categoryName, match?.round].filter(Boolean));
}

function seasonPlayoffStageRound(match) {
  const playoff = isPlayoffMatch(match) || /playoff/i.test(`${match?.source?.name || ''} ${match?.round || ''}`);
  return playoff ? findSeasonRound(activeSeason(), ['Playoff Stage']) : null;
}

function getSeasonRoundInfo(match) {
  const round = seasonRoundForMatch(match);
  if (round) return roundWindowForDisplay(round);

  const configuredWindow = getConfiguredRoundWindow(match);
  if (configuredWindow) {
    return {
      name: match.categoryName || match.round,
      ...configuredWindow,
      defaultDateTime: match.scheduledAt || null
    };
  }

  return roundWindowForDisplay(seasonPlayoffStageRound(match));
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
  return PLAYOFF_ROUND_NAMES.get(normalizeRoundCategory(value)) || String(value || 'Playoff Stage');
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

// Puts an approved caster's stream URL on the match's row in the Google Sheet (STREAM column).
// Never throws; returns a short warning for staff when the sheet could not be updated.
async function logStreamLinkToSheet(request, approvedBy = null) {
  if (!request?.streamUrl) return null;
  if (!parseFaceitMatchRoomLink(request.faceitUrl)) {
    return 'The Google Sheet was not updated: this request has no valid FACEIT matchroom link to find the match row. Add the stream link to the Game Schedules tab by hand.';
  }
  const row = buildStreamLinkSheetRow(request, { approvedBy, highlight: await sheetHighlightFor(request.matchId, { adding: true }) });
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

// How the match's sheet row should be coloured: main stream beats community cast; with neither the
// colour is cleared. `adding` is a cast being added right now (so at least community);
// `excludeRequestId` is a cast being taken off right now.
async function sheetHighlightFor(matchId, { adding = false, excludeRequestId = null } = {}) {
  if (matchId && await getMainStreamCoverage(matchId)) return 'main';
  if (adding || !matchId) return 'community';
  const casters = (await listStreamRequests({ matchId })).filter((request) =>
    request.id !== excludeRequestId && STREAM_CONNECTION_STATUSES.includes(request.status));
  return casters.length ? 'community' : 'none';
}

// Puts the main stream's Twitch link on the match's row and colours it as a main stream game. When
// the stream changes, the old link is taken off first. Returns a line for the staff reply.
async function syncMainStreamSheetLink(coverage, actorId = null) {
  const streamUrl = mainStreamUrlFor(coverage);
  if (!streamUrl) return null;
  if (!parseFaceitMatchRoomLink(coverage.faceitUrl)) return '⚠️ Google Sheet not updated: no valid FACEIT link to find the row.';
  const previous = coverage.sheetStreamUrl || null;
  try {
    if (previous && previous !== streamUrl) {
      await scheduleSheet.removeStreamLink(buildMainStreamSheetRow(coverage, { streamUrl: previous, actorId }));
    }
    const result = await scheduleSheet.addStreamLink(buildMainStreamSheetRow(coverage, { streamUrl, actorId }));
    if (!result.ok) {
      await appendAuditLog({ type: 'stream_link_sheet_failed', matchId: coverage.matchId, actorId, error: result.error, mainStream: true }).catch(() => null);
      return `⚠️ Google Sheet not updated with ${streamUrl}: ${result.error}`;
    }
    await saveMainStreamCoverage(coverage.matchId, { sheetStreamUrl: streamUrl });
    await appendAuditLog({ type: 'stream_link_sheet_logged', matchId: coverage.matchId, actorId, mainStream: true, skipped: Boolean(result.skipped) }).catch(() => null);
    return result.skipped ? null : `📄 Added ${streamUrl} to the Google Sheet row (highlighted blue for main stream).`;
  } catch (error) {
    console.error('Main stream sheet link failed:', error);
    return `⚠️ Google Sheet not updated: ${error?.message || error}`;
  }
}

// --- Google Sheet: results and "Stats Collected?" -------------------------------
// Every 10 minutes: write the winner and score of finished matches into the "Result" column, and
// tick "Stats Collected?" for matches whose post-cast form is in. Each is written once per match
// (tracked in sheetSync). Small batches keep FACEIT and Apps Script calls low.
const SHEET_SYNC_EVERY_MS = 10 * 60 * 1000;
const RESULT_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const RESULT_AFTER_START_MS = 45 * 60 * 1000;
let lastSheetSyncAt = 0;

function laterIso(now, minutes) {
  return new Date(now + minutes * 60 * 1000).toISOString();
}

function sheetSyncDue(entry, now) {
  return !entry?.doneAt && !(entry?.nextCheckAt && Date.parse(entry.nextCheckAt) > now);
}

async function syncSheetResultsAndStats(now = Date.now()) {
  if (scheduleSheet.mode === 'log-only' || now - lastSheetSyncAt < SHEET_SYNC_EVERY_MS) return;
  lastSheetSyncAt = now;
  const sync = await getSheetSync();
  await syncSheetResults(sync, now);
  await syncSheetStatsCollected(sync, now);
}

async function syncSheetResults(sync, now) {
  const due = (await listSchedules()).filter((schedule) => {
    if (!schedule.adminApproved || !schedule.matchId) return false;
    const startMs = Date.parse(schedule.scheduledAtIso || schedule.scheduledAt || '');
    if (!Number.isFinite(startMs) || startMs > now - RESULT_AFTER_START_MS || startMs < now - RESULT_LOOKBACK_MS) return false;
    return sheetSyncDue(sync[`result:${schedule.matchId}`], now);
  }).slice(0, 5);
  for (const schedule of due) {
    const key = `result:${schedule.matchId}`;
    const match = await faceit.getMatch(schedule.matchId).catch(() => null);
    const status = String(match?.status || '').toLowerCase();
    if (!match) {
      await updateSheetSync(key, { nextCheckAt: laterIso(now, 30) });
      continue;
    }
    if (/cancel/.test(status)) {
      await updateSheetSync(key, { doneAt: new Date(now).toISOString(), skipped: 'canceled' });
      continue;
    }
    if (!/finished/.test(status)) {
      await updateSheetSync(key, { nextCheckAt: laterIso(now, 15) });
      continue;
    }
    const stats = await faceit.getMatchStats(schedule.matchId).catch(() => null);
    const result = buildMatchResult(match, stats);
    if (!result) {
      await updateSheetSync(key, { nextCheckAt: laterIso(now, 60), note: 'no winner yet' });
      continue;
    }
    const stored = await getStoredMatch(schedule.matchId);
    const faceitLink = match.faceitUrl || stored?.match?.faceitUrl || `https://www.faceit.com/en/cs2/room/${schedule.matchId}`;
    const written = await scheduleSheet.writeMatchResult({
      faceitLink, matchId: schedule.matchId, result: result.text, winner: result.winner,
      teamAScore: result.teamAScore, teamBScore: result.teamBScore
    });
    if (written.ok) {
      await updateSheetSync(key, { doneAt: new Date(now).toISOString(), text: result.text });
      await appendAuditLog({ type: 'sheet_result_written', matchId: schedule.matchId, result: result.text }).catch(() => null);
    } else {
      await updateSheetSync(key, { nextCheckAt: laterIso(now, 6 * 60), error: written.error });
      console.warn(`[Sheet] result for ${schedule.matchId} not written: ${written.error}`);
    }
  }
}

async function syncSheetStatsCollected(sync, now) {
  const sinceMs = Date.parse(config.postCastFormGateSince || '') || 0;
  const byMatch = new Map();
  for (const request of await listStreamRequests()) {
    if (!request.matchId || !request.faceitUrl || byMatch.has(request.matchId)) continue;
    if (!['received', 'waived'].includes(postCastFormState(request))) continue;
    if ((Date.parse(request.postCastReminderSentAt || '') || 0) < sinceMs) continue;
    if (!sheetSyncDue(sync[`stats:${request.matchId}`], now)) continue;
    byMatch.set(request.matchId, request);
  }
  for (const request of [...byMatch.values()].slice(0, 10)) {
    const key = `stats:${request.matchId}`;
    const written = await scheduleSheet.markStatsCollected({ faceitLink: request.faceitUrl, matchId: request.matchId, requestId: request.id });
    if (written.ok) {
      await updateSheetSync(key, { doneAt: new Date(now).toISOString(), requestId: request.id });
      await appendAuditLog({ type: 'sheet_stats_collected', matchId: request.matchId, requestId: request.id }).catch(() => null);
    } else {
      await updateSheetSync(key, { nextCheckAt: laterIso(now, 6 * 60), error: written.error });
      console.warn(`[Sheet] Stats Collected for ${request.matchId} not ticked: ${written.error}`);
    }
  }
}

// Takes a withdrawn or revoked caster's link back off the match's row. Never throws.
async function removeStreamLinkFromSheet(request, actorId = null) {
  if (!request?.streamUrl || !parseFaceitMatchRoomLink(request.faceitUrl)) return null;
  const row = buildStreamLinkSheetRow(request, { approvedBy: actorId, highlight: await sheetHighlightFor(request.matchId, { excludeRequestId: request.id }) });
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
    result.warning = `Round windows for ${activeSeason()?.name || 'this season'} are not configured yet. Admins must verify this proposed time before approval.`;
  }

  return result;
}

function getScheduleWindowForMatch(match) {
  if (isGroupStageMatch(match)) {
    // Group Stage teams may schedule anywhere in the whole Group Stage window, not just their round's.
    const roundNumber = getGroupStageRoundNumber(match);
    const groupStage = roundWindowForDisplay(findSeasonRound(activeSeason(), ['Group Stage']))
      || config.roundWindows['group stage']
      || roundWindowForDisplay(findSeasonRound(activeSeason(), roundNumber !== 999 ? [`Round ${roundNumber}`] : []));
    if (!groupStage) return null;

    return {
      start: groupStage.start,
      end: groupStage.end,
      label: 'Group Stage scheduling window'
    };
  }

  const window = roundWindowForDisplay(seasonRoundForMatch(match))
    || getConfiguredRoundWindow(match)
    || config.roundWindows[String(canonicalPlayoffRoundName(match.round || match.categoryName)).toLowerCase()]
    || roundWindowForDisplay(seasonPlayoffStageRound(match));
  if (!window) return null;

  return {
    ...window,
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
  await autoEndStaleBroadcasts(now).catch((error) => console.error('Live board auto-end failed:', error));
  await sendPreCastReminders(now).catch((error) => console.error('Pre-cast reminders failed:', error));
  await sendPostCastNudges(now).catch((error) => console.error('Post-cast form nudges failed:', error));
  await sendOverduePostCastForms(now).catch((error) => console.error('Overdue post-cast forms failed:', error));
  await postOpenMatchesDigest(now).catch((error) => console.error('Daily open matches post failed:', error));
  await sendDueMainStreamPrompts(now).catch((error) => console.error('Main stream connection prompts failed:', error));
  await syncSheetResultsAndStats(now).catch((error) => console.error('Sheet results/stats sync failed:', error));
  await syncCrewAvailability(now).catch((error) => console.error('Crew availability sync failed:', error));
  await sendCrewAvailabilityReminders(now).catch((error) => console.error('Crew availability reminders failed:', error));
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
            if (scheduleUpdated) await refreshLiveBoardMessage(updated);
          }
        }
        if (scheduleUpdated) {
          // Only the casters who requested this match are told. Tournament Ops are not pinged; the staff
          // card above is edited in place so it still shows the new time.
          const undeliveredCasterIds = [];
          for (const request of selectScheduleChangeRecipients(currentRequests)) {
            const text = buildScheduleChangeNotice({
              scheduleChange,
              matchup: request.matchup || matchId,
              status: request.status,
              previousLabel: previousIso ? formatEasternDateTimeInput(previousIso) : null,
              nextLabel
            });
            const sent = await notifyStreamRequester(request, text, { staffFallback: false });
            if (!sent) undeliveredCasterIds.push(request.requesterId);
          }
          if (undeliveredCasterIds.length) {
            console.warn(`[Stream] could not deliver schedule change for ${matchId} to: ${undeliveredCasterIds.join(', ')}`);
          }
          await appendAuditLog({
            type: scheduleChange === 'scheduled' ? 'stream_match_scheduled' : scheduleChange === 'unscheduled' ? 'stream_schedule_removed' : 'stream_schedule_changed',
            matchId,
            previousIso,
            nextIso,
            requestCount: currentRequests.length,
            undeliveredCasterIds
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
        if (updated?.status === 'approved' && canceled) {
          await cancelCoverageNotice(updated, { reason: 'FACEIT canceled the match.' });
          await endBroadcast(updated, { reason: 'faceit_canceled' });
        }
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


// --- Crew availability (staff schedule sheet) ---------------------------------------
// The PROD SCHEDULE / Admin Schedule tabs are read through the sheet web app every
// CREW_AVAILABILITY_SYNC_MINUTES and stored, so the crew form (which must open within
// 3 seconds) can list who is free without waiting on Google. See src/availability.js.

let crewAvailabilitySyncing = null;
const CREW_NAME_RETRY_MS = 6 * 60 * 60 * 1000;
const CREW_STATE_WORDS = { free: 'Free', partial: 'Partly free', maybe: 'Maybe', unknown: 'Not filled in', busy: 'Busy' };

function crewPeopleWithIds(stored) {
  const links = stored?.links || {};
  const resolved = stored?.resolved || {};
  return (stored?.data?.people || []).map((person) => ({
    ...person,
    userId: links[person.key] || resolved[person.key]?.id || null
  }));
}

async function crewGuild() {
  const channel = config.productionScheduleChannelId
    ? await client.channels.fetch(config.productionScheduleChannelId).catch(() => null)
    : null;
  return channel?.guild || client.guilds.cache.first() || null;
}

// A Discord member whose username, display name or nickname is exactly this sheet name.
async function findMemberIdByName(guild, name) {
  const target = normalizeCrewName(name);
  if (!guild || !target) return null;
  const found = await guild.members.search({ query: String(name).trim().slice(0, 32), limit: 10 }).catch(() => null);
  const members = found ? [...found.values()] : [];
  const namesOf = (member) => [member.user?.username, member.user?.globalName, member.nickname, member.displayName]
    .filter(Boolean)
    .map(normalizeCrewName);
  const exact = members.filter((member) => namesOf(member).includes(target));
  if (exact.length === 1) return exact[0].id;
  return exact.find((member) => normalizeCrewName(member.user?.username) === target)?.id || null;
}

async function resolveCrewDiscordIds(people, stored, now) {
  const guild = await crewGuild();
  const resolved = { ...(stored?.resolved || {}) };
  for (const person of people) {
    if (stored?.links?.[person.key] || resolved[person.key]?.id) continue;
    const checkedAt = Date.parse(resolved[person.key]?.checkedAt || '') || 0;
    if (checkedAt && now - checkedAt < CREW_NAME_RETRY_MS) continue;
    const id = guild ? await findMemberIdByName(guild, person.name) : null;
    resolved[person.key] = { id, checkedAt: new Date(now).toISOString() };
  }
  return resolved;
}

// Reads the staff schedule tabs (at most every CREW_AVAILABILITY_SYNC_MINUTES unless forced).
async function syncCrewAvailability(now = Date.now(), { force = false } = {}) {
  if (!config.crewAvailabilityEnabled || scheduleSheet.mode !== 'apps-script') return null;
  const stored = await getCrewAvailability();
  const last = Math.max(Date.parse(stored.syncedAt || '') || 0, Date.parse(stored.errorAt || '') || 0);
  if (!force && now - last < config.crewAvailabilitySyncMinutes * 60_000) return stored;
  if (crewAvailabilitySyncing) return crewAvailabilitySyncing;
  crewAvailabilitySyncing = (async () => {
    const result = await scheduleSheet.readAvailability();
    if (!result.ok) {
      if (result.error !== stored.error) console.error(`[Crew availability] Could not read the staff schedule: ${result.error}`);
      await updateCrewAvailability((state) => {
        state.error = result.error;
        state.errorAt = new Date(now).toISOString();
      });
      return getCrewAvailability();
    }
    const data = parseAvailability(result.tabs, { referenceYear: Number(easternParts(now).dateKey.slice(0, 4)) });
    const resolved = await resolveCrewDiscordIds(data.people, stored, now);
    await updateCrewAvailability((state) => {
      state.data = data;
      state.resolved = resolved;
      state.syncedAt = new Date(now).toISOString();
      state.error = null;
      state.errorAt = null;
    });
    const fresh = await getCrewAvailability();
    await checkBookedCrewAvailability(fresh, now).catch((error) => console.error('[Crew availability] booked crew check failed:', error));
    return fresh;
  })().finally(() => {
    crewAvailabilitySyncing = null;
  });
  return crewAvailabilitySyncing;
}

// Start time of every main stream match (approved schedule, else FACEIT's time) and its crew.
async function crewBookings() {
  const bookings = [];
  for (const { coverage, schedule } of await listMainStreamCoverageWithSchedules()) {
    const approved = schedule?.adminApproved ? (schedule.scheduledAtIso || schedule.scheduledAt || null) : null;
    const startMs = Date.parse(approved || coverage.faceitScheduledAtIso || '');
    if (!Number.isFinite(startMs)) continue;
    bookings.push({ coverage, matchId: coverage.matchId, startMs, userIds: crewUserIds(coverage.crew || {}) });
  }
  return bookings;
}

function workedThisWeek(bookings, userId, now) {
  const week = new Set(weekKeys(mondayOf(easternParts(now).dateKey)));
  return bookings.filter((booking) => booking.userIds.includes(userId) && week.has(easternParts(booking.startMs).dateKey)).length;
}

function bookedElsewhereAt(bookings, userId, matchId, startMs, durationMinutes) {
  return bookings.some((booking) => booking.matchId !== matchId
    && booking.userIds.includes(userId)
    && Math.abs(booking.startMs - startMs) < durationMinutes * 60_000);
}

function rankCrew(people, role, { matchId = null, startMs, bookings, now, durationMinutes = config.crewMatchLengthMinutes }) {
  return rankCrewForRole(people, role, startMs, durationMinutes, {
    workCount: (person) => (person.userId ? workedThisWeek(bookings, person.userId, now) : 0),
    bookedElsewhere: (person) => Boolean(person.userId) && bookedElsewhereAt(bookings, person.userId, matchId, startMs, durationMinutes)
  });
}

function crewEntryDescription(entry) {
  const note = entry.note && !/^free all day$/i.test(entry.note) ? `: ${entry.note}` : '';
  return `${CREW_STATE_WORDS[entry.state] || entry.state}${note}`.slice(0, 100);
}

async function matchStartMs(matchId) {
  const coverage = await getMainStreamCoverage(matchId);
  let iso = await approvedScheduleIso(matchId) || coverage?.faceitScheduledAtIso || null;
  if (!iso) iso = getFaceitScheduledAtIso((await getStoredMatch(matchId))?.match);
  const ms = Date.parse(iso || '');
  return Number.isFinite(ms) ? ms : null;
}

// Options for each crew form dropdown: people free for this match who can do the role, plus the
// current picks. null = availability is not available (the form then uses plain user pickers).
async function crewFormSelectOptions(coverage) {
  const stored = await getCrewAvailability();
  if (!config.crewAvailabilityEnabled || !stored.data) return null;
  const startMs = await matchStartMs(coverage.matchId);
  if (!startMs) return null;
  const now = Date.now();
  const people = crewPeopleWithIds(stored).filter((person) => person.userId);
  const bookings = await crewBookings();
  const crew = coverage.crew || {};
  const result = {};
  for (const field of PRODUCTION_CREW_FIELDS) {
    const role = CREW_FIELD_ROLES[field.key];
    const current = (field.key === 'casters' ? crew.casters || [] : [crew[field.key]]).filter(Boolean);
    const options = [];
    const seen = new Set();
    for (const entry of rankCrew(people, role, { matchId: coverage.matchId, startMs, bookings, now })) {
      const id = entry.person.userId;
      const isCurrent = current.includes(id);
      if (seen.has(id) || (!isCurrent && !['free', 'partial', 'maybe'].includes(entry.state))) continue;
      seen.add(id);
      options.push({
        label: `${entry.person.name} (${entry.worked} this week)`.slice(0, 100),
        description: crewEntryDescription(entry),
        value: id,
        default: isCurrent
      });
    }
    for (const id of current) {
      if (seen.has(id)) continue;
      seen.add(id);
      const user = client.users.cache.get(id);
      options.unshift({
        label: (user?.globalName || user?.username || `User ${id}`).slice(0, 100),
        description: 'Current pick (not on the staff schedule)',
        value: id,
        default: true
      });
    }
    result[field.key] = options.slice(0, 25);
  }
  return result;
}

// Free people for the given roles, for alerts ("who could replace them").
async function crewReplacementLines(matchId, roles, { excludeUserIds = [] } = {}) {
  const stored = await getCrewAvailability();
  const startMs = await matchStartMs(matchId);
  if (!stored.data || !startMs) return [];
  const now = Date.now();
  const people = crewPeopleWithIds(stored).filter((person) => !excludeUserIds.includes(person.userId));
  const bookings = await crewBookings();
  const lines = [];
  for (const role of [...new Set(roles)]) {
    const free = rankCrew(people, role, { matchId, startMs, bookings, now })
      .filter((entry) => ['free', 'partial'].includes(entry.state))
      .slice(0, 6)
      .map((entry) => `${entry.person.name} (${entry.state === 'free' ? `${entry.worked} this week` : entry.note})`);
    lines.push(`**${CREW_ROLE_LABELS[role]} free:** ${free.length ? free.join(', ') : 'nobody on the staff schedule'}`);
  }
  return lines;
}

function crewRoleFromLabel(label) {
  if (/^caster/i.test(label)) return 'caster';
  if (/^producer/i.test(label)) return 'producer';
  if (/^observer/i.test(label)) return 'observer';
  if (/^admin/i.test(label)) return 'admin';
  return 'social';
}

// Crew alerts go to CREW_ALERTS_CHANNEL_ID (pinging whoever set the crew), or by DM to that person.
async function sendCrewAlert(coverage, content) {
  const setBy = coverage?.crewSetBy || coverage?.requestedBy || null;
  if (config.crewAlertsChannelId) {
    const channel = await client.channels.fetch(config.crewAlertsChannelId).catch(() => null);
    if (channel?.isTextBased?.()) {
      const sent = await channel.send({
        content: `${setBy ? `<@${setBy}> ` : ''}${content}`.slice(0, 2000),
        allowedMentions: { parse: [], users: setBy ? [setBy] : [] }
      }).catch(() => null);
      if (sent) return true;
    }
  }
  if (setBy) {
    const user = await client.users.fetch(setBy).catch(() => null);
    if (user && await user.send({ content: content.slice(0, 2000), allowedMentions: { parse: [] } }).then(() => true).catch(() => false)) return true;
  }
  console.log(`[Crew alert] ${content.replace(/\s+/g, ' ').slice(0, 300)}`);
  return false;
}

// After each sync: a booked crew member whose day turned busy is flagged to staff (once per change).
async function checkBookedCrewAvailability(stored, now = Date.now()) {
  if (!stored?.data) return;
  const byUser = new Map(crewPeopleWithIds(stored).filter((person) => person.userId).map((person) => [person.userId, person]));
  for (const { coverage, startMs, userIds } of await crewBookings()) {
    if (startMs <= now || !userIds.length) continue;
    const previous = coverage.crewAvailabilityStates || {};
    const states = {};
    const alerts = [];
    for (const userId of userIds) {
      const person = byUser.get(userId);
      if (!person) continue;
      const { state, note } = availabilityAt(person, startMs, config.crewMatchLengthMinutes);
      states[userId] = state;
      if (state === 'busy' && previous[userId] && previous[userId] !== 'busy') alerts.push({ userId, person, note });
    }
    if (JSON.stringify(states) !== JSON.stringify(previous)) {
      await saveMainStreamCoverage(coverage.matchId, { crewAvailabilityStates: states });
    }
    for (const alert of alerts) {
      const roles = crewRolesFor(coverage.crew || {}, alert.userId);
      const replacements = await crewReplacementLines(coverage.matchId, roles.map(crewRoleFromLabel), { excludeUserIds: [alert.userId] });
      await sendCrewAlert(coverage, [
        `⚠️ **${alert.person.name}** (<@${alert.userId}>) is now marked busy for **${coverage.matchup}** (${discordTimestamp(new Date(startMs).toISOString(), 'F')}), and they're ${roles.join(' & ') || 'on the crew'}.`,
        alert.note ? `Staff schedule says: "${alert.note}".` : null,
        "They're still on the crew. To swap them, use `/cf mainstream` or the crew form.",
        ...replacements
      ].filter(Boolean).join('\n'));
      await appendAuditLog({ type: 'main_stream_crew_availability_changed', matchId: coverage.matchId, userId: alert.userId }).catch(() => null);
    }
  }
}

// Sunday at CREW_REMINDER_TIME: DM everyone who has not filled in any day of next week.
async function sendCrewAvailabilityReminders(now = Date.now()) {
  if (!config.crewAvailabilityEnabled || scheduleSheet.mode !== 'apps-script') return;
  const { dateKey, minutes } = easternParts(now);
  if (weekdayIndex(dateKey) !== 6) return;
  const [hour, minute] = config.crewReminderTime.split(':').map(Number);
  const target = hour * 60 + minute;
  if (minutes < target || minutes > target + 180) return;
  const nextMonday = addDaysToKey(dateKey, 1);
  let stored = await getCrewAvailability();
  if (stored.reminderWeek === nextMonday) return;
  stored = await syncCrewAvailability(now, { force: true }) || stored;
  if (!stored?.data || stored.error) return;
  const claimed = await updateCrewAvailability((state) => {
    if (state.reminderWeek === nextMonday) return false;
    state.reminderWeek = nextMonday;
    return true;
  });
  if (!claimed) return;
  const { people, missingTabs } = peopleMissingWeek(stored.data, nextMonday);
  const withIds = new Map(crewPeopleWithIds(stored).map((person) => [person.key, person.userId]));
  const weekLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
    .format(new Date(`${nextMonday}T12:00:00Z`));
  let sent = 0;
  const failed = [];
  const unlinked = [];
  for (const person of people) {
    const userId = withIds.get(person.key);
    if (!userId) {
      unlinked.push(person.name);
      continue;
    }
    const user = await client.users.fetch(userId).catch(() => null);
    const ok = Boolean(user && await user.send({
      content: [
        `📅 Hey ${person.name}! Your CROSSFIRE staff availability for the week of **${weekLabel}** isn't filled in yet.`,
        `Please mark it here: <${config.availabilitySheetUrl}>`,
        '- Colour the day with **Can Work**, **Could Work** or **Cant Work**',
        '- Only free part of the day? Use the partial colour and write your latest start time (e.g. `8:00PM START`) or your hours (e.g. `After 7 EST`).'
      ].join('\n')
    }).then(() => true).catch(() => false));
    if (ok) sent += 1;
    else failed.push(person.name);
  }
  await appendAuditLog({ type: 'crew_availability_reminders_sent', week: nextMonday, sent, failed: failed.length, unlinked: unlinked.length }).catch(() => null);
  const summary = [
    `📅 Sunday reminder: DMed ${sent} staff member(s) to fill in the week of ${weekLabel}.`,
    failed.length ? `Couldn't DM (DMs closed): ${failed.join(', ')}.` : null,
    unlinked.length ? `Not linked to Discord, so not reminded: ${unlinked.join(', ')}. Link them with \`/cf crewlink\`.` : null,
    missingTabs.length ? `Next week isn't on ${missingTabs.join(' / ')} yet, so nobody there was reminded.` : null
  ].filter(Boolean).join('\n');
  if (config.crewAlertsChannelId) await sendCrewAlert(null, summary);
  else console.log(`[Crew availability] ${summary.replace(/\n/g, ' ')}`);
}

// Typed crew picks in `/cf mainstream`: a suggestion (user ID), an @mention, or a name.
async function resolveCrewInput(raw) {
  const text = String(raw || '').trim();
  if (!text) return { id: null };
  const direct = text.match(/^<@!?(\d{17,20})>$/) || text.match(/^(\d{17,20})$/);
  if (direct) return { id: direct[1] };
  const name = text.replace(/^@/, '');
  const person = crewPeopleWithIds(await getCrewAvailability()).find((entry) => entry.key === normalizeCrewName(name) && entry.userId);
  if (person) return { id: person.userId };
  const id = await findMemberIdByName(await crewGuild(), name);
  if (id) return { id };
  return { id: null, error: `⚠️ Couldn't find "${text}", so that role wasn't changed. Pick from the suggestions or @mention them.` };
}

// Warnings for crew picked in `/cf mainstream` who aren't marked free for the match.
async function crewAvailabilityWarnings(matchId, userIds) {
  const stored = await getCrewAvailability();
  const startMs = await matchStartMs(matchId);
  if (!stored.data || !startMs || !userIds.length) return [];
  const byUser = new Map(crewPeopleWithIds(stored).filter((person) => person.userId).map((person) => [person.userId, person]));
  const bookings = await crewBookings();
  const time = discordTimestamp(new Date(startMs).toISOString(), 't');
  const lines = [];
  for (const userId of [...new Set(userIds)]) {
    if (bookedElsewhereAt(bookings, userId, matchId, startMs, config.crewMatchLengthMinutes)) {
      lines.push(`⚠️ <@${userId}> is already on another main stream crew around ${time}.`);
      continue;
    }
    const person = byUser.get(userId);
    if (!person) continue;
    const { state, note } = availabilityAt(person, startMs, config.crewMatchLengthMinutes);
    if (state !== 'free') lines.push(`⚠️ <@${userId}> isn't marked free at ${time} (${CREW_STATE_WORDS[state].toLowerCase()}${note ? `: ${note}` : ''}).`);
  }
  return lines;
}

async function crewAutocompleteChoices(interaction, focused) {
  const role = CREW_FIELD_ROLES[focused.name];
  if (!role) return [];
  const stored = await getCrewAvailability();
  const people = crewPeopleWithIds(stored).filter((person) => person.userId && person.roles?.includes(role));
  if (!people.length) return [];
  const link = interaction.options.getString('match');
  const parsed = link ? parseFaceitMatchRoomLink(link) : null;
  const matchId = parsed?.matchId || (await getStoredMatchByChannel(interaction.channelId))?.match?.id || null;
  const startMs = matchId ? await matchStartMs(matchId) : null;
  const now = Date.now();
  const bookings = await crewBookings();
  const query = normalizeCrewName(focused.value);
  let entries = startMs
    ? rankCrew(people, role, { matchId, startMs, bookings, now })
    : people
      .map((person) => ({ person, state: 'unknown', note: 'match time unknown', worked: workedThisWeek(bookings, person.userId, now) }))
      .sort((a, b) => a.worked - b.worked || a.person.name.localeCompare(b.person.name));
  // Typing a name searches everyone; an empty box shows only people who can make it.
  entries = query
    ? entries.filter((entry) => entry.person.key.includes(query))
    : entries.filter((entry) => !startMs || ['free', 'partial', 'maybe'].includes(entry.state));
  const seen = new Set();
  return entries
    .filter((entry) => !seen.has(entry.person.userId) && seen.add(entry.person.userId))
    .slice(0, 25)
    .map((entry) => ({
      name: `${entry.person.name} · ${startMs ? crewEntryDescription(entry) : 'time unknown'} · ${entry.worked} this week`.slice(0, 100),
      value: entry.person.userId
    }));
}

// "Thurs 9:30pm", "11/12 9pm", "today 9pm", "November 12 9:30 PM" -> ms (Eastern).
function parseCrewWhen(text, now = Date.now()) {
  let value = String(text || '').trim();
  const weekday = value.match(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+(.*)$/i);
  if (weekday) {
    const wanted = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(weekday[1].toLowerCase());
    const today = easternParts(now).dateKey;
    const dateKey = addDaysToKey(today, (wanted - weekdayIndex(today) + 7) % 7);
    const [year, month, day] = dateKey.split('-');
    value = `${Number(month)}/${Number(day)}/${year} ${weekday[2]}`;
  }
  return parseEasternDateTime(value, new Date(now));
}

async function handleWhosFreeCommand(interaction) {
  await interaction.deferReply({ ephemeral: true });
  if (!config.crewAvailabilityEnabled) {
    await interaction.editReply('Crew availability is turned off (`CREW_AVAILABILITY=off`).');
    return;
  }
  const whenText = interaction.options.getString('when', true).trim();
  const durationMinutes = interaction.options.getInteger('length') || config.crewMatchLengthMinutes;
  const stored = await syncCrewAvailability(Date.now()) || await getCrewAvailability();
  if (!stored?.data) {
    await interaction.editReply(`I haven't been able to read the staff schedule yet${stored?.error ? `: ${stored.error}` : ''}. The sheet web app needs the "availability" action (redeploy the Apps Script).`);
    return;
  }
  const link = parseFaceitMatchRoomLink(whenText);
  const matchId = link?.matchId || null;
  const startMs = matchId ? await matchStartMs(matchId) : parseCrewWhen(whenText);
  if (!Number.isFinite(startMs)) {
    await interaction.editReply(matchId
      ? 'That match has no time yet.'
      : `Couldn't read "${whenText}". Try \`Thurs 9:30pm\`, \`11/12 9pm\`, \`today 9pm\` or a FACEIT matchroom link.`);
    return;
  }
  const now = Date.now();
  const people = crewPeopleWithIds(stored);
  const bookings = await crewBookings();
  const fields = [];
  for (const role of CREW_ROLES) {
    const ranked = rankCrew(people, role, { matchId, startMs, bookings, now, durationMinutes });
    if (!ranked.length) continue;
    const group = (state, format) => ranked.filter((entry) => entry.state === state).map(format);
    const free = group('free', (entry) => `${entry.person.name} (${entry.worked})`);
    const partial = group('partial', (entry) => `${entry.person.name} (${entry.note})`);
    const maybe = group('maybe', (entry) => entry.person.name);
    const value = [
      free.length ? `✅ ${free.join(', ')}` : '✅ Nobody free for the whole match',
      partial.length ? `🟡 Partly: ${partial.join(', ')}` : null,
      maybe.length ? `❔ Maybe: ${maybe.join(', ')}` : null
    ].filter(Boolean).join('\n');
    fields.push({ name: CREW_ROLE_LABELS[role], value: value.slice(0, 1024) });
  }
  const syncedMs = Date.parse(stored.syncedAt || '');
  const embed = new EmbedBuilder()
    .setTitle(`Who's free · ${new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(startMs))} ET`)
    .setDescription(`${discordTimestamp(new Date(startMs).toISOString(), 'F')} for ${durationMinutes / 60} hours. Numbers are main stream matches worked this week.`)
    .addFields(fields.length ? fields : [{ name: 'Nobody', value: 'Nobody is on the staff schedule for these roles.' }])
    .setColor(0x4a86e8)
    .setFooter({ text: `Staff schedule read ${Number.isFinite(syncedMs) ? new Date(syncedMs).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET' : 'just now'}${stored.error ? ' (latest read failed)' : ''}` });
  await interaction.editReply({ embeds: [embed] });
}

async function handleCrewLinkCommand(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const name = interaction.options.getString('name')?.trim() || null;
  const user = interaction.options.getUser('user');
  const stored = await getCrewAvailability();
  const people = crewPeopleWithIds(stored);
  if (name && user) {
    const key = normalizeCrewName(name);
    await updateCrewAvailability((state) => {
      state.links = { ...(state.links || {}), [key]: user.id };
    });
    await appendAuditLog({ type: 'crew_name_linked', actorId: interaction.user.id, name, userId: user.id }).catch(() => null);
    const onSheet = people.some((person) => person.key === key);
    await interaction.editReply({
      content: `Linked **${name}** to <@${user.id}>.${onSheet ? '' : ' (That name is not on the staff schedule right now; check the spelling.)'}`,
      allowedMentions: { parse: [] }
    });
    return;
  }
  if (name) {
    const person = people.find((entry) => entry.key === normalizeCrewName(name));
    await interaction.editReply({
      content: person?.userId
        ? `**${person.name}** is linked to <@${person.userId}>${stored.links?.[person.key] ? ' (set by hand)' : ' (matched automatically)'}. Give \`user:\` to change it.`
        : `**${name}** isn't linked. Run \`/cf crewlink name:${name} user:@them\`.`,
      allowedMentions: { parse: [] }
    });
    return;
  }
  if (!stored.data) {
    await interaction.editReply(`The staff schedule hasn't been read yet${stored.error ? `: ${stored.error}` : ''}.`);
    return;
  }
  const unlinked = people.filter((person) => !person.userId).map((person) => person.name);
  await interaction.editReply([
    `**Staff schedule:** ${people.length} people on ${(stored.data.tabs || []).map((tab) => tab.name).join(', ')}; ${people.length - unlinked.length} linked to Discord.`,
    unlinked.length ? `**Not linked:** ${unlinked.join(', ')}\nLink them with \`/cf crewlink name:<name> user:@them\`.` : 'Everyone is linked.',
    (stored.data.tabs || []).some((tab) => !tab.legendFound) ? '⚠️ No colour legend was found on one tab, so colours are read by shade (green free, yellow maybe, red busy).' : null,
    stored.error ? `⚠️ The latest read failed: ${stored.error}` : null
  ].filter(Boolean).join('\n'));
}

async function handleCrewLinkAutocomplete(interaction) {
  const query = normalizeCrewName(interaction.options.getFocused());
  const people = crewPeopleWithIds(await getCrewAvailability());
  await interaction.respond(people
    .filter((person) => !query || person.key.includes(query))
    .sort((a, b) => Number(Boolean(a.userId)) - Number(Boolean(b.userId)) || a.name.localeCompare(b.name))
    .slice(0, 25)
    .map((person) => ({ name: `${person.name}${person.userId ? '' : ' (not linked)'}`.slice(0, 100), value: person.name.slice(0, 100) })))
    .catch(() => null);
}

// "Can't make it" on a crew DM: confirm, then take them off and tell staff with who could replace them.
async function handleCrewDropButton(interaction) {
  const [action, matchId] = interaction.customId.split(':');
  if (action === 'crew_drop_no') {
    await interaction.update({ content: "OK, you're still on the crew.", components: [] });
    return;
  }
  const coverage = await getMainStreamCoverage(matchId);
  if (action === 'crew_drop') {
    if (!coverage || !crewRolesFor(coverage.crew || {}, interaction.user.id).length) {
      await interaction.reply({ content: "You're not on this crew anymore, so there's nothing to do." });
      return;
    }
    await interaction.reply({
      content: `Take yourself off the crew for **${coverage.matchup}**? Staff will be told right away.`,
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`crew_drop_yes:${matchId}`).setLabel('Yes, take me off').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('crew_drop_no').setLabel('Never mind').setStyle(ButtonStyle.Secondary)
      )]
    });
    return;
  }
  await interaction.update({ content: 'Taking you off the crew…', components: [] });
  const message = await dropCrewMember(matchId, interaction.user.id);
  await interaction.editReply({ content: message, components: [] });
}

async function dropCrewMember(matchId, userId) {
  const coverage = await getMainStreamCoverage(matchId);
  if (!coverage) return "That match isn't on the main stream anymore, so there's nothing to drop.";
  const crew = coverage.crew || {};
  const roles = crewRolesFor(crew, userId);
  if (!roles.length) return "You're not on this crew anymore.";
  const next = { ...crew, casters: (crew.casters || []).filter((id) => id !== userId) };
  for (const key of ['producer', 'observer', 'admin', 'social']) {
    if (next[key] === userId) next[key] = null;
  }
  const forget = (ids) => (ids || []).filter((id) => id !== userId);
  const updated = await saveMainStreamCoverage(matchId, {
    crew: next,
    crewDmedUserIds: forget(coverage.crewDmedUserIds || coverage.schedulePingedUserIds),
    schedulePingedUserIds: forget(coverage.schedulePingedUserIds),
    ipPingedUserIds: forget(coverage.ipPingedUserIds)
  });
  if (updated.scheduleMessageId) await publishMainStreamSchedulePost(updated).catch(() => null);
  await appendAuditLog({ type: 'main_stream_crew_dropped', matchId, userId, roles }).catch(() => null);
  const startMs = await matchStartMs(matchId);
  const missing = [
    !next.casters.length ? 'Casters' : null,
    !next.producer ? 'Producer' : null
  ].filter(Boolean);
  const replacements = await crewReplacementLines(matchId, roles.map(crewRoleFromLabel), { excludeUserIds: [userId] });
  await sendCrewAlert(updated, [
    `🚨 <@${userId}> can't make it to **${coverage.matchup}**${startMs ? ` (${discordTimestamp(new Date(startMs).toISOString(), 'F')})` : ''}. They were ${roles.join(' & ')} and have been taken off the crew.`,
    missing.length ? `${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} now empty.` : null,
    ...replacements,
    'Add a replacement with `/cf mainstream` or the crew form.'
  ].filter(Boolean).join('\n'));
  return `You're off the crew for **${coverage.matchup}**. Staff have been told. Thanks for letting us know!`;
}


// `!addgame <FACEIT link>` (or `!add game`): puts a match on the Google Sheet by hand when the
// automatic write was missed. Adds the row (or updates it: one row per FACEIT link), using the
// approved time or else FACEIT's, then re-adds the main stream / approved caster stream links.
async function handleAddGameToSheet(message, content) {
  if (!canUseBotAdminCommand(message.member) && !canManageStreamRequests(message.member)) {
    await message.reply('Only admins/match staff can add games to the sheet.');
    return;
  }
  const link = content.replace(/^!add\s*game\b/i, '').trim().split(/\s+/)[0] || '';
  const parsed = parseFaceitMatchRoomLink(link);
  if (!parsed) {
    await message.reply('Use `!addgame FACEIT_MATCHROOM_LINK`, for example `!addgame https://www.faceit.com/en/cs2/room/1-...`.');
    return;
  }
  if (scheduleSheet.mode !== 'apps-script') {
    await message.reply('No Google Sheet is connected (`SCHEDULE_SHEET_WEBHOOK_URL` is empty).');
    return;
  }
  await message.channel.sendTyping?.().catch(() => null);
  let stored = await getStoredMatch(parsed.matchId);
  if (!stored?.match) {
    const match = await findFaceitMatchForLink(link, parsed.matchId).catch(() => null);
    if (!match) {
      await message.reply(`I couldn't find that match on FACEIT (${configuredFaceitSourceSummary()}).`);
      return;
    }
    stored = { match: { ...match, faceitUrl: match.faceitUrl || parsed.url } };
  }
  if (!stored.match.faceitUrl) stored = { ...stored, match: { ...stored.match, faceitUrl: parsed.url } };

  // Time: the admin-approved schedule, else FACEIT's scheduled time.
  const schedule = await getSchedule(parsed.matchId).catch(() => null);
  let proposal = schedule?.adminApproved ? { ...schedule, matchId: parsed.matchId } : null;
  let timeSource = 'the approved time';
  if (!proposal?.scheduledAtIso) {
    const faceitMatch = await faceit.getMatch(parsed.matchId).catch(() => null);
    const faceitIso = getFaceitScheduledAtIso(faceitMatch) || getFaceitScheduledAtIso(stored.match);
    proposal = faceitIso ? { scheduledAtIso: faceitIso, scheduledAt: faceitIso, matchId: parsed.matchId } : proposal;
    timeSource = faceitIso ? "FACEIT's time (no time approved in Discord)" : null;
  }

  const warning = await logScheduleToSheet({ stored, proposal, approvedBy: message.author.id, kind: 'manual' });
  const matchup = `${stored.match.teamA || 'TBD'} vs ${stored.match.teamB || 'TBD'}`;
  if (warning) {
    await message.reply({ content: `⚠️ ${matchup}: ${warning}`, allowedMentions: { parse: [] } });
    return;
  }
  const lines = [
    `📄 **${matchup}** is on the Google Sheet${proposal?.scheduledAtIso ? ` for ${discordTimestamp(new Date(proposal.scheduledAtIso).toISOString(), 'F')}, using ${timeSource}` : ' with no time yet (nothing approved and nothing on FACEIT)'}.`
  ];

  // Stream links the sheet should have for this match.
  const coverage = await getMainStreamCoverage(parsed.matchId);
  if (coverage) {
    const sheetLine = await syncMainStreamSheetLink(coverage, message.author.id).catch(() => null);
    lines.push(sheetLine && sheetLine.startsWith('⚠️') ? sheetLine : `📺 Main stream link: ${mainStreamUrlFor(coverage)}`);
  }
  const approved = (await listStreamRequests({ matchId: parsed.matchId, status: 'approved' })).filter((request) => request.streamUrl);
  for (const request of approved) {
    const streamWarning = await logStreamLinkToSheet(request, request.reviewedBy || null).catch((error) => error?.message || String(error));
    lines.push(streamWarning ? `⚠️ ${request.streamUrl}: ${streamWarning}` : `🎙️ Community cast link: ${request.streamUrl}`);
  }
  await appendAuditLog({ type: 'schedule_sheet_added_by_hand', actorId: message.author.id, matchId: parsed.matchId }).catch(() => null);
  await message.reply({ content: lines.join('\n').slice(0, 2000), allowedMentions: { parse: [] } });
}
