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
import { createArena } from './arena.js';
import { createVoiceRooms } from './voiceRooms.js';
import { createPicks } from './picks.js';
import { createReactionRoles, parseMessageLink } from './reactionRoles.js';
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
  listCrewHistory,
  saveCrewHistory,
  getMatchStatsCache,
  saveMatchStats,
  getMatchVetoCache,
  saveMatchVetoes,
  incrementCounter,
  getCounter,
  createTicket,
  saveTicket,
  getTicket,
  listTickets,
  listMainStreamForms,
  createMainStreamForm,
  updateMainStreamForm,
  getTeamInfoCache,
  saveTeamInfoCache,
  claimMainStreamDeliveryPrompt,
  deleteMainStreamCoverage,
  getSheetSync,
  updateSheetSync,
  getOpenMatchesDigest,
  claimOpenMatchesDigest,
  saveOpenMatchesDigest,
  createRosterChange,
  saveRosterChange,
  getRosterChange,
  listOpenRosterChanges,
  listArenaLinks,
  getReactionRoleMessages
} from './store.js';
import { arenaTeams } from './arenaLogic.js';
import {
  LEGACY_SEASON_SEED,
  PLAYOFF_ROUND_NAMES,
  SEASON7_PLAYOFF_ROUNDS,
  currentSeason,
  easternDateKey,
  findSeasonByRef,
  seasonContains,
  findSeasonRound,
  formatRoundLine,
  formatRoundsText,
  formatSeasonRange,
  makeSeasonId,
  mergeMissingSeasonRounds,
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
  UPCOMING_POST_FOOTER,
  MAINSTREAM_FORMS_ID,
  groupMainStreamDays,
  isMainStreamFormId,
  mainStreamFormRequest,
  buildMainStreamFormMessage
} from './streamRequest.js';
import { normalizeScheduleText, parseScheduleClock } from './scheduleInput.js';
import { buildMatchResult } from './matchResult.js';
import { createFireCrownThrottle, isFireCrownMention } from './fireCrown.js';
import { buildApplicationCard, parseApplication } from './casterApplications.js';
import {
  buildRosterChangePost,
  faceitNicknameFromUrl,
  faceitTeamIdFromUrl,
  historyWhenText,
  playerFromFaceit,
  isStarterSlot,
  parseDiscordId,
  planRosterOps,
  playerLines,
  rosterSlots,
  slotTaken,
  slotText,
  validateNewPlayer,
  isCoachSlot,
  faceitTeamPageUrl,
  rosterUndoPlan,
  rosterFaceitExpectations,
  checkFaceitRoster,
  duplicatePlayerLines,
  rosterReminderDue
} from './rosterChange.js';
import {
  ARENA_APPEAL_TYPES,
  ARENA_LINK_ISSUES,
  ARENA_LIVE_PROBLEMS,
  ARENA_REPORT_REASONS,
  ARENA_TICKET_KINDS,
  arenaMatchPlayersText,
  arenaTicketKind,
  arenaTicketPriority,
  splitNames,
  ticketTopicLabel,
  buildTicketHeader,
  buildTranscript,
  MATCH_STATES,
  matchIssuePriority,
  PRIORITIES,
  priorityText,
  rosterPriority,
  shouldBumpRoster,
  ticketAlertText,
  ticketChannelName,
  ticketNumberText,
  ticketTopic,
  TICKET_TOPICS
} from './tickets.js';
import { buildRoundup, buildSocialCard, buildSocialResultCard, matchTopPlayer, normalizeHandle, teamSocials } from './socialInfo.js';
import { buildPrepPack, compactBotVeto, compactFaceitVeto, compactMatchStats, faceitVetoUnderway, findTeamInfo, matchTimeMs as prepMatchTimeMs, parseTeamInfoRows, prepSignature, teamKey, vetoSummary } from './prepPack.js';
import {
  STAT_ROLES,
  STAT_ROLE_LABELS,
  computeSeasonCrewStats,
  formatRanking,
  parseSchedulePost,
  personSeasonHistory,
  schedulePostDateText
} from './crewStats.js';
import {
  CREW_FIELD_ROLES,
  CREW_ROLES,
  CREW_ROLE_LABELS,
  addDaysToKey,
  availabilityAt,
  dayAvailability,
  easternParts,
  mondayOf,
  normalizeCrewName,
  parseAvailability,
  parseDayKey,
  peopleMissingWeek,
  rankCrewForRole,
  sheetSlotFor,
  weekdayIndex,
  weekKeys
} from './availability.js';
import { createWebsitePublisher } from './websitePublisher.js';
import { buildMainStreamSheetRow, buildScheduleSheetRow, buildStreamLinkSheetRow, createScheduleSheet } from './scheduleSheet.js';
import { isAuthorizedStaffMember, parseForceDirective } from './operationsPolicy.js';
import { installDiscordContentGuard, splitDiscordContent } from './discordLimits.js';

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
let prepTimer = null;
const fireCrownMayPost = createFireCrownThrottle(config.fireCrownCooldownSeconds * 1000);

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

// No message fails for being over Discord's 2000-character limit: it is trimmed instead, and the
// log names the code that built it so that message can be split or shortened properly.
installDiscordContentGuard({
  onTrim: (length) => {
    const origin = (new Error().stack || '').split('\n').filter((line) => /[\\/]src[\\/]/.test(line) && !/node_modules|discordLimits\.js/.test(line)).slice(0, 4).map((line) => line.trim());
    console.warn(`[Discord] message of ${length} characters trimmed to fit the 2000 limit.${origin.length ? ` From: ${origin.join(' <- ')}` : ''}`);
  }
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.Reaction
  ]
});

// Crossfire Arena 10mans: team voice channels and auto-drag (src/arena.js).
const arena = createArena({
  client,
  faceit,
  config,
  isAdminStaff: (member) => isAdminStaff(member),
  memberForDiscordText: (guild, text) => rosterMemberFor(guild, text)
});
// React-for-roles messages (src/reactionRoles.js): Crossfire Arena and Game Ping.
const reactionRoles = createReactionRoles({ client, roles: config.arenaReactionRoles });
// Join To Create personal voice channels (src/voiceRooms.js).
const voiceRooms = createVoiceRooms({ client, config, isAdminStaff: (member) => isAdminStaff(member) });
// Playoff bracket picks from the website (src/picks.js): /picks, lock reminders, standings.
const picks = createPicks({ client, config });

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
  await reorderExistingPlayoffMatchChannels().catch((error) => {
    console.error('[Playoff channel order] failed:', error);
  });
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
  // Prep packs get their own faster timer so a FACEIT veto's maps show up within 30 seconds.
  if (!prepTimer) {
    prepTimer = setInterval(() => {
      runPrepPacks().catch((error) => console.error('Prep packs failed:', error));
    }, PREP_VETO_RECHECK_MS);
    prepTimer.unref?.();
  }
  arena.start();
  await voiceRooms.start().catch((error) => console.error('Join To Create start failed:', error));
  reactionRoles.sync().catch((error) => console.error('Reaction roles catch-up failed:', error));
  picks.start().catch((error) => console.error('Bracket picks start failed:', error));
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      if (interaction.commandName === 'request') await handleStreamRequestAutocomplete(interaction);
      if (interaction.commandName === 'crossfire' && interaction.options.getSubcommand(false) === 'teamnotes') await handleTeamNotesAutocomplete(interaction);
      const cfSubcommand = interaction.commandName === 'cf' ? interaction.options.getSubcommand(false) : null;
      if (cfSubcommand === 'mainstream') await handleMainStreamAutocomplete(interaction);
      else if (cfSubcommand === 'crewlink') await handleCrewLinkAutocomplete(interaction);
      else if (cfSubcommand === 'crewstats') await handleSeasonAutocomplete(interaction);
      else if (interaction.commandName === 'cf') await handleSeasonAutocomplete(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId === 'ticket_start') {
      await handleTicketStart(interaction);
      return;
    }
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_topic') {
      await handleTicketTopic(interaction);
      return;
    }
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_arena_kind') {
      await handleArenaTicketKind(interaction);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_form:')) {
      await handleTicketForm(interaction);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_close_submit:')) {
      await handleTicketClose(interaction);
      return;
    }
    if (/^ticket_(claim|reassign|assign|priority|close):/.test(interaction.customId || '')) {
      await handleTicketControl(interaction);
      return;
    }
    if (interaction.customId?.startsWith('troster_')) {
      await handleTicketRoster(interaction);
      return;
    }
    if (interaction.isButton() && /^roster_(done|doneforce|undo|undoyes)(:|$)/.test(interaction.customId || '')) {
      await handleRosterDone(interaction);
      return;
    }
    if (interaction.customId?.startsWith('vc_')) {
      await voiceRooms.handleComponent(interaction);
      return;
    }
    if (interaction.customId?.startsWith('arena_')) {
      await arena.handleComponent(interaction);
      return;
    }
    if (interaction.isMessageContextMenuCommand?.() && interaction.commandName === 'Repost with Link FACEIT button') {
      await handleArenaRepost(interaction);
      return;
    }
    if (interaction.isMessageContextMenuCommand?.() && interaction.commandName === 'Add Arena role reactions') {
      await handleArenaRolesCommand(interaction, interaction.targetMessage);
      return;
    }
    if (interaction.isChatInputCommand() && interaction.commandName === 'arena' && interaction.options.getSubcommand(false) === 'roles') {
      await handleArenaRolesCommand(interaction);
      return;
    }
    if (interaction.isChatInputCommand() && interaction.commandName === 'arena') {
      await arena.handleCommand(interaction);
      return;
    }
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'picks') {
        await picks.handleCommand(interaction);
        return;
      }
      if (interaction.commandName === 'request') {
        await handleStreamRequestCommand(interaction);
        return;
      }
      if (interaction.commandName === 'crossfire') {
        await handleCrossfireCommand(interaction);
        return;
      }
      const streamStaffCommand = interaction.commandName === 'cf'
        && ['streams', 'forms', 'upcoming', 'mainstream', 'whosfree', 'crewlink', 'crewstats', 'crewimport', 'prep'].includes(interaction.options.getSubcommand(false));
      const prodCommand = interaction.commandName === 'cf' && interaction.options.getSubcommand(false) === 'prep' && hasProdRole(interaction.member);
      const allowed = prodCommand || (streamStaffCommand ? canManageStreamRequests(interaction.member) : canUseBotAdminCommand(interaction.member));
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
    if (interaction.isButton() && /^crew_import(_cancel)?(:|$)/.test(interaction.customId)) {
      await handleCrewImportButton(interaction);
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
    if (subcommand === 'tickets') {
      await postTicketPanel(interaction);
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
    if (subcommand === 'crewstats') {
      await handleCrewStatsCommand(interaction);
      return;
    }
    if (subcommand === 'prep') {
      await handlePrepCommand(interaction);
      return;
    }
    if (subcommand === 'crewimport') {
      await handleCrewImportCommand(interaction);
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
  if (subcommand === 'teamnotes') {
    await handleTeamNotesCommand(interaction);
    return;
  }
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
  const seasons = await listSeasons();
  const season7 = findSeasonByRef(seasons, 'season-7');
  const merged = mergeMissingSeasonRounds(season7, SEASON7_PLAYOFF_ROUNDS, { endDate: '2026-12-13' });
  if (merged.added.length) {
    const result = await updateSeasons((items) => planUpdateSeason(items, season7.id, {
      endDate: merged.season.endDate,
      rounds: merged.season.rounds
    }));
    if (!result?.error) {
      console.log(`[Season] Added ${merged.added.length} Season 7 playoff round(s).`);
      await appendAuditLog({
        type: 'season_playoff_rounds_migrated',
        seasonId: season7.id,
        roundCount: merged.added.length,
        rounds: merged.added.map((round) => round.name)
      });
    }
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
      ? `Saved the CSTV password for **${season.name}**. Every IP sent from now on goes to casters as \`password "${parsed.value}"; connect IP:PORT\` (type **No** in the form's password box to skip it for one match).`
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

// `/cf commands`: the list is longer than one Discord message, so it goes out as a reply plus
// follow-ups, split between lines.
async function handleCommandHelp(interaction) {
  const [first, ...rest] = splitDiscordContent(COMMAND_HELP_LINES.join('\n'));
  await interaction.reply({ content: first, ephemeral: true });
  for (const content of rest) await interaction.followUp({ content, ephemeral: true });
}

const COMMAND_HELP_LINES = [
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
  '`/cf season action:set CSTV password password:<password>` - the password added to every IP sent to casters, as `password "PW"; connect IP:PORT`. `password:none` removes it.',
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
];

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot || !message.guild) return;

    const content = message.content.trim();

    // #FireCrown anywhere in a message, or !FireCrown on its own: the running total goes up, the
    // message gets a 🔥 reaction, and the bot says #FireCrown at most once per
    // FIRECROWN_COOLDOWN_SECONDS (60) per channel. !FireCrownCount: the total. (Bots are ignored
    // above, so the bot's own #FireCrown never triggers itself.)
    if (/^!firecrown$/i.test(content) || isFireCrownMention(content)) {
      await incrementCounter('fireCrown');
      await message.react('🔥').catch(() => null);
      if (fireCrownMayPost(message.channelId)) {
        await message.channel.send({ content: '#FireCrown', allowedMentions: { parse: [] } });
      }
      return;
    }
    if (/^!firecrowncount$/i.test(content)) {
      const total = await getCounter('fireCrown');
      await message.channel.send({ content: `#FireCrown count: **${total}**`, allowedMentions: { parse: [] } });
      return;
    }

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

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  let movedByArena = false;
  try {
    movedByArena = await arena.onVoiceStateUpdate(oldState, newState);
  } catch (error) {
    console.error('Arena voice move failed:', error);
  }
  try {
    await voiceRooms.onVoiceStateUpdate(oldState, newState, { movedElsewhere: movedByArena });
  } catch (error) {
    console.error('Join To Create failed:', error);
  }
});

// /arena roles: post the react-for-roles message in this channel, or set up an existing message.
// From the right-click menu, target is the message that was clicked.
async function handleArenaRolesCommand(interaction, target = null) {
  if (!arena.isStaff(interaction.member)) {
    await interaction.reply({ content: 'Only Arena staff can do that.', ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const linkText = target ? null : interaction.options.getString('message_link');
  let existing = target;
  if (linkText) {
    const link = parseMessageLink(linkText);
    const channel = link ? await client.channels.fetch(link.channelId).catch(() => null) : null;
    existing = channel?.messages ? await channel.messages.fetch(link.messageId).catch(() => null) : null;
    if (!existing) {
      await interaction.editReply('I couldn\'t open that message. Right-click the message > **Copy Message Link** and paste it here.');
      return;
    }
  }
  if (!existing && !interaction.channel?.isTextBased?.()) {
    await interaction.editReply('Run this in a text channel.');
    return;
  }
  const message = await reactionRoles.setUp({ channel: interaction.channel, existing });
  const list = config.arenaReactionRoles.map((entry) => `${entry.emoji} = <@&${entry.roleId}>`).join(', ');
  await interaction.editReply({ content: `✅ Reaction roles are on [this message](${message.url}): ${list}.`, allowedMentions: { parse: [] } });
}

// Right-click > Repost with Link FACEIT button: a copy of the message (text and images) posted by the
// bot with the Link FACEIT / Unlink buttons. Role reactions on the original carry over to the copy.
async function handleArenaRepost(interaction) {
  if (!arena.isStaff(interaction.member)) {
    await interaction.reply({ content: 'Only Arena staff can do that.', ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const original = interaction.targetMessage;
  const channel = original.channel || await client.channels.fetch(original.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) {
    await interaction.editReply("I can't post in that channel.");
    return;
  }
  const files = [...original.attachments.values()].map((file) => ({ attachment: file.url, name: file.name }));
  const embeds = original.author?.id === client.user.id ? original.embeds : [];
  if (!original.content && !files.length && !embeds.length) {
    await interaction.editReply('That message has nothing to copy.');
    return;
  }
  const copy = await channel.send({
    content: original.content || undefined,
    embeds,
    files,
    components: [arena.linkButtonsRow()],
    allowedMentions: { parse: [] }
  }).catch((error) => error);
  if (copy instanceof Error) {
    await interaction.editReply(`Couldn't post the copy: ${copy.message}`);
    return;
  }
  const hadRoles = Boolean((await getReactionRoleMessages())[original.id]);
  if (hadRoles) await reactionRoles.setUp({ channel, existing: copy });
  await interaction.editReply([
    `✅ Reposted [here](${copy.url}) with the **Link FACEIT** button${hadRoles ? ' and the 🎮 / 🔔 role reactions' : ''}.`,
    'Now delete your original message.',
    hadRoles ? 'Anyone who reacted on the original keeps their role, but should react on the new one too so unreacting works.' : 'Want role reactions on it too? Right-click the new message > Apps > **Add Arena role reactions**.'
  ].join('\n'));
}

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  try {
    await reactionRoles.onReaction(reaction, user, false);
  } catch (error) {
    console.error('Reaction role removal failed:', error);
  }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    if (await reactionRoles.onReaction(reaction, user, true)) return;
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
  const syncedChannels = [];

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
    syncedChannels.push({
      channelId: discordIds.channelId,
      categoryId: discordIds.categoryId
    });

    created += 1;
  }

  const reordered = await reorderSyncedMatchChannels(guild, syncedChannels);

  const roundText = roundFilter?.label || 'all detected rounds';
  const coverage = summarizeSyncCoverage(matches);
  if (!allMatches.length) {
    await interaction.editReply(`FACEIT has not published any matches yet for ${configuredFaceitSourceSummary()}. No Discord channels were created.`);
    return;
  }
  await interaction.editReply(truncateDiscordMessage([
    `Synced ${created} match channel(s) for ${roundText}. Skipped ${skipped}.`,
    reordered ? `Ordered ${reordered} existing channel(s) from the top of the FACEIT bracket to the bottom.` : null,
    coverage
  ].filter(Boolean).join('\n')));
}

async function reorderSyncedMatchChannels(guild, syncedChannels) {
  if (syncedChannels.length < 2) return syncedChannels.length;

  await guild.channels.fetch();
  const byCategory = new Map();
  for (const entry of syncedChannels) {
    const items = byCategory.get(entry.categoryId) || [];
    items.push(entry);
    byCategory.set(entry.categoryId, items);
  }

  let reordered = 0;
  for (const [categoryId, entries] of byCategory) {
    const category = guild.channels.cache.get(categoryId);
    const channels = entries
      .map((entry) => guild.channels.cache.get(entry.channelId))
      .filter((channel) => channel?.parentId === categoryId);
    if (!category || channels.length < 2) {
      reordered += channels.length;
      continue;
    }

    await guild.channels.setPositions(channels.map((channel, index) => ({
      channel: channel.id,
      position: category.rawPosition + index + 1
    })));
    reordered += channels.length;
  }

  return reordered;
}

async function reorderExistingPlayoffMatchChannels() {
  const guild = await client.guilds.fetch(config.discordGuildId);
  await guild.channels.fetch();

  const matches = filterAndSortMatchesForSync(
    (await faceit.getMatches()).map(normalizeConfiguredMatch).filter(isPlayoffMatch),
    null
  );
  const existingChannels = [];

  for (const match of matches) {
    const stored = await getStoredMatch(match.id);
    const channel = stored?.discord?.channelId
      ? guild.channels.cache.get(stored.discord.channelId)
      : findAuditMatchChannel(guild, match, makeMatchChannelName(match));
    if (!channel?.isTextBased?.() || !channel.parentId) continue;

    existingChannels.push({
      channelId: channel.id,
      categoryId: channel.parentId
    });
  }

  const reordered = await reorderSyncedMatchChannels(guild, existingChannels);
  console.log(`[Playoff channel order] reordered ${reordered} existing channel(s); created 0.`);
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
  // A time the bot can't read never goes to the other team or staff: it can't be checked against
  // the scheduling window or written to the sheet. Tournament Ops can still send it with --force.
  if (!parsedSchedule && !(canScheduleDirectly && forceDirective.reason)) {
    const command = kind === 'reschedule' ? 'reschedule' : 'schedule';
    await message.reply([
      `I couldn't read **${proposedText.slice(0, 100)}** as a date and time, so nothing was sent.`,
      `Write the date and the time with AM/PM, like \`!${command} 11/9 8:30 PM ET\` or \`!${command} Monday 8:30 PM ET\`.`,
      canScheduleDirectly ? 'Tournament Ops can add `--force reason` after the time to send it anyway.' : null
    ].filter(Boolean).join('\n'));
    return;
  }
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
      const updated = await updateFormRecord(id, {
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
  const load = async () => groupMissingForms(await allFormRequests(requesterId ? { requesterId } : {}), { since });
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
  let requests = await allFormRequests(filter);
  let sheetCheckFailed = false;
  if (checkSheet) {
    const check = await checkFormsInSheet(selectFormCasts(requests, { since }).missing.map((request) => request.id), '/cf forms');
    sheetCheckFailed = check.failed;
    if (check.foundIds.length) requests = await allFormRequests(filter);
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
      ? `Marked the form for **${updated.matchup}** (${formsWhoText(updated.requesterId)}) received.`
      : 'That cast could not be marked received. It may have changed; run `/cf forms` again.',
    ephemeral: true,
    allowedMentions: { parse: [] }
  });
}

// DMs one caster every form they still owe and records the nudge on each cast. A staff nudge also
// counts as the automatic 48-hour one.
async function sendStaffFormNudge(casterId, missing, actorId, { bulk = false } = {}) {
  const sent = casterId === MAINSTREAM_FORMS_ID
    ? await postMainStreamForm(missing, { reminder: true })
    : await dmStreamRequester(missing[0], buildStaffFormNudge(missing, {
      formLink: postCastFormLinkFor,
      gate: config.postCastFormGate
    }));
  const now = new Date().toISOString();
  if (sent) {
    for (const request of missing) {
      await updateFormRecord(request.id, {
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
    content = `${formsWhoText(casterId)} has no missing forms now${arrived ? ` (${arrived} just showed up on the sheet)` : ''}. Nothing was sent.`;
  } else {
    const until = staffNudgeCooldownUntil(missing);
    if (until) {
      content = `${formsWhoText(casterId)} was already nudged by staff. You can nudge again ${discordTimestamp(new Date(until).toISOString(), 'R')}.`;
    } else {
      const sent = await sendStaffFormNudge(casterId, missing, interaction.user.id);
      const what = missing.map((request) => request.matchup || request.id).join(', ');
      if (casterId === MAINSTREAM_FORMS_ID) {
        content = sent
          ? `📨 Posted a reminder for ${missing.length} main stream form(s) in <#${config.mainStreamFormChannelId}>: ${what}.`
          : '⚠️ Could not post the main stream form reminder. Check MAINSTREAM_FORM_CHANNEL_ID and that the bot can post there.';
      } else {
        content = sent
          ? `📨 DMed <@${casterId}> about ${missing.length} missing form(s): ${what}.`
          : `⚠️ Could not DM <@${casterId}>. Their DMs are closed, so reach out another way.`;
      }
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
  const mentions = (list) => list.map((group) => formsWhoText(group.requesterId)).join(', ');
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
  const due = (await allFormRequests())
    .filter((request) => isPostCastNudgeDue(request, now, { since: config.postCastFormGateSince }))
    .slice(0, 25);
  if (!due.length) return;
  const checkedAt = new Date(now).toISOString();
  for (const request of due) await updateFormRecord(request.id, { postCastNudgeCheckedAt: checkedAt }, ['approved']);
  const lookup = await scheduleSheet.lookupPostCastForms(due.map((request) => request.id))
    .catch((error) => ({ ok: false, error: error?.message || String(error), found: {} }));
  if (!lookup.ok || lookup.skipped) {
    console.warn(`[Stream] post-cast nudges waiting: the form sheet could not be checked (${lookup.skipped ? 'sheet is in log-only mode' : lookup.error}).`);
    return;
  }
  for (const request of due) {
    const hit = lookup.found?.[request.id];
    if (hit) {
      await updateFormRecord(request.id, {
        postCastFormSubmittedAt: hit.submittedAt || checkedAt,
        postCastFormSource: 'form'
      }, ['approved']);
      await appendAuditLog({ type: 'stream_post_cast_form_received', matchId: request.matchId || null, requestId: request.id, source: 'sheet' });
      continue;
    }
    const sent = request.mainStream
      ? await postMainStreamForm([request], { reminder: true })
      : await dmStreamRequester(request, buildPostCastNudge(request, {
        formUrl: postCastFormLinkFor(request),
        gate: config.postCastFormGate
      }));
    await updateFormRecord(request.id, {
      postCastNudgeSentAt: checkedAt,
      postCastNudgeDelivery: sent ? 'delivered' : 'failed'
    }, ['approved']);
    await appendAuditLog({ type: 'stream_post_cast_nudge', matchId: request.matchId || null, requestId: request.id, delivered: sent });
    if (!sent) console.warn(`[Stream] post-cast form nudge for ${request.id} could not be delivered (DMs closed?)`);
  }
}

function postCastFormLinkFor(request) {
  return postCastFormLink(config.postCastFormPrefillUrl, config.postCastFormUrl, request, { timeZone: config.defaultTimezone });
}

// --- Main stream post-cast forms ---------------------------------------------------------------
// One post-cast stats form per main stream day (and channel): Twitch only has numbers for the whole
// stream. Posted in MAINSTREAM_FORM_CHANNEL_ID pinging MAINSTREAM_FORM_USER_IDS once that day's
// matches are over. In /cf forms they are one "MainStream" row; nudges go to the same channel.

function formsWhoText(id) {
  return id === MAINSTREAM_FORMS_ID ? 'MainStream' : `<@${id}>`;
}

// Main stream day forms, shaped like stream requests.
async function mainStreamFormRequests() {
  return (await listMainStreamForms()).map(mainStreamFormRequest).filter(Boolean);
}

// Stream requests plus main stream forms, for the forms views, nudges and sheet checks.
async function allFormRequests(filter = {}) {
  if (filter.requesterId === MAINSTREAM_FORMS_ID) return mainStreamFormRequests();
  const requests = await listStreamRequests(filter);
  return filter.requesterId ? requests : [...requests, ...await mainStreamFormRequests()];
}

// Updates a cast's form fields, or a main stream match's.
async function updateFormRecord(id, patch, allowedStatuses = undefined) {
  if (!isMainStreamFormId(id)) return updateStreamRequest(id, patch, allowedStatuses);
  const saved = await updateMainStreamForm(id, patch);
  return saved ? mainStreamFormRequest(saved) : null;
}

async function postMainStreamForm(requests, { reminder = false } = {}) {
  const channel = config.mainStreamFormChannelId ? await client.channels.fetch(config.mainStreamFormChannelId).catch(() => null) : null;
  if (!channel?.isTextBased?.()) {
    console.warn('[Forms] main stream form not posted: set MAINSTREAM_FORM_CHANNEL_ID (or STREAM_REQUEST_CHANNEL_ID) to a channel the bot can post in.');
    return false;
  }
  if (!config.mainStreamFormUserIds.length) console.warn('[Forms] MAINSTREAM_FORM_USER_IDS is empty, so nobody is pinged for the main stream form.');
  const message = await channel.send({
    content: buildMainStreamFormMessage(requests, { formLink: postCastFormLinkFor, userIds: config.mainStreamFormUserIds, reminder }),
    allowedMentions: { parse: [], users: config.mainStreamFormUserIds }
  }).catch(() => null);
  return Boolean(message);
}

// A main stream match's FACEIT state for its day's form: 'finished', 'canceled' or 'pending'. Asked
// at most every 5 minutes per match once its time has come; a final answer is kept.
async function mainStreamMatchState(coverage, startMs, now) {
  if (['finished', 'canceled'].includes(coverage.postCastMatchState)) return coverage.postCastMatchState;
  if (now < startMs || now - (Date.parse(coverage.postCastFormCheckedAt || '') || 0) < 5 * 60 * 1000) return 'pending';
  const match = await faceit.getMatch(coverage.matchId).catch(() => null);
  const status = String(match?.status || '').toLowerCase();
  const state = status.includes('cancel') ? 'canceled' : status.includes('finished') ? 'finished' : 'pending';
  await saveMainStreamCoverage(coverage.matchId, { postCastFormCheckedAt: new Date(now).toISOString(), ...(state === 'pending' ? {} : { postCastMatchState: state }) });
  return state;
}

// One post-cast form per main stream day and channel. It goes out once every main stream match
// that day is finished or cancelled, or 12 hours after the day's last match time. Days this season
// that ended before MAINSTREAM_FORM_SINCE are added to /cf forms quietly (no post, no automatic
// reminder). Days where every match was cancelled get none.
async function syncMainStreamDayForms(now = Date.now()) {
  const sinceMs = Date.parse(config.mainStreamFormSince || '') || 0;
  const seasonSinceMs = Date.parse(config.postCastFormGateSince || '') || 0;
  const existing = new Set((await listMainStreamForms()).map((form) => form.id));
  const items = (await crewBookings())
    // Later games the same day count too (still pending), so the form waits for the whole night.
    .filter(({ startMs }) => startMs >= seasonSinceMs && startMs <= now + 24 * 60 * 60 * 1000)
    .map(({ coverage, startMs }) => ({
      coverage,
      startMs,
      matchId: coverage.matchId,
      dateKey: easternParts(startMs).dateKey,
      streamUrl: mainStreamUrlFor(coverage),
      matchup: coverage.matchup || coverage.matchId,
      faceitUrl: coverage.faceitUrl || null
    }));
  for (const day of groupMainStreamDays(items)) {
    if (existing.has(day.id)) continue;
    const states = [];
    for (const item of day.items) states.push(await mainStreamMatchState(item.coverage, item.startMs, now));
    const overdue = now >= day.lastStartMs + 12 * 60 * 60 * 1000;
    if (states.includes('pending') && !overdue) continue;
    const played = day.items.filter((item, index) => states[index] !== 'canceled');
    if (!played.length) continue;
    const quiet = day.lastStartMs < sinceMs;
    const nowIso = new Date(now).toISOString();
    const startIso = new Date(played[0].startMs).toISOString();
    // Forms already marked per match (before forms went per day) carry over.
    const carried = played.every((item) => item.coverage.postCastForm?.postCastFormSubmittedAt);
    const created = await createMainStreamForm({
      id: day.id,
      dateKey: day.dateKey,
      streamUrl: day.streamUrl,
      startIso,
      matchIds: played.map((item) => item.matchId),
      matchups: played.map((item) => item.matchup),
      faceitUrls: played.map((item) => item.faceitUrl),
      postCastReminderSentAt: quiet ? startIso : nowIso,
      postCastReminderDelivery: quiet ? 'backfilled' : 'pending',
      ...(quiet ? { postCastNudgeSentAt: nowIso, postCastNudgeDelivery: 'skipped' } : {}),
      ...(carried ? { postCastFormSubmittedAt: nowIso, postCastFormWaivedAt: nowIso, postCastFormSource: 'staff', postCastFormNote: 'marked received per match before forms went per day' } : {})
    });
    if (!created) continue;
    if (quiet || carried) {
      await appendAuditLog({ type: 'mainstream_post_cast_form_backfilled', requestId: created.id, matchIds: created.matchIds }).catch(() => null);
      continue;
    }
    const sent = await postMainStreamForm([mainStreamFormRequest(created)]);
    await updateMainStreamForm(created.id, { postCastReminderDelivery: sent ? 'delivered' : 'failed' });
    await appendAuditLog({ type: 'mainstream_post_cast_form_sent', requestId: created.id, matchIds: created.matchIds, delivered: sent }).catch(() => null);
  }
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
      `Form, with your cast details already filled in: ${postCastFormLinkFor(outstanding)}`,
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
        .setDescription(field.key === 'casters' ? 'Caster 1, plus Caster 2 if there is one. Free people first; ⚠️ = not free then.' : 'Free people first, from the staff schedule; ⚠️ = not free then.')
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
  // Anyone picked who isn't marked free (or is on another crew then), like /cf mainstream does.
  const warnings = await crewAvailabilityWarnings(matchId, crewUserIds(crew)).catch(() => []);
  await interaction.editReply({ content: [result.line, removedLine, ipLine, ...warnings].filter(Boolean).join('\n').slice(0, 2000), allowedMentions: { parse: [] } });
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
  if (isMainStreamFormId(requestId)) {
    const existing = (await mainStreamFormRequests()).find((entry) => entry.id === requestId);
    if (!existing) return null;
    const updated = await updateFormRecord(requestId, {
      postCastFormSubmittedAt: existing.postCastFormSubmittedAt || now,
      postCastFormWaivedAt: now,
      postCastFormWaivedBy: actorId,
      postCastFormSource: 'staff',
      postCastFormNote: note || existing.postCastFormNote || null
    });
    if (updated) await appendAuditLog({ type: 'stream_post_cast_form_waived', actorId, matchId: updated.matchId, requestId });
    return updated;
  }
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
    `Thanks for covering **${claimed.matchup}** for Crossfire! Please fill out the post-cast stats form (request ${claimed.id}; your cast details are already filled in):`,
    postCastFormLinkFor(claimed),
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
  await syncMainStreamDayForms(now).catch((error) => console.error('[Forms] main stream day forms failed:', error));
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
    if (row.matchId && !result.skipped) {
      await updateSheetSync(`row:${row.matchId}`, { ok: Boolean(result.ok), error: result.ok ? null : result.error || null }).catch(() => null);
    }
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
  await checkApprovedSchedules(sync, now).catch((error) => console.error('Schedule check against FACEIT failed:', error));
  await syncSheetResults(await getSheetSync(), now);
  await refreshRecentPostCastForms(now).catch((error) => console.error('Post-cast form refresh failed:', error));
  await syncSheetStatsCollected(sync, now);
}

// Casts from the last two weeks whose post-cast form went out but hasn't been seen yet: ask the
// form sheet about them (one call per 50) so a submitted form is noticed within ~10 minutes and
// "Stats Collected?" gets ticked, instead of waiting for the 48-hour nudge or someone opening
// /request mine or /cf forms.
const POST_CAST_REFRESH_DAYS = 14;
async function refreshRecentPostCastForms(now = Date.now()) {
  const sinceMs = Math.max(Date.parse(config.postCastFormGateSince || '') || 0, now - POST_CAST_REFRESH_DAYS * 24 * 60 * 60 * 1000);
  const ids = (await allFormRequests())
    .filter((request) => request.status === 'approved'
      && postCastFormState(request) === 'missing'
      && (Date.parse(request.postCastReminderSentAt || '') || 0) >= sinceMs)
    .map((request) => request.id);
  if (!ids.length) return;
  const { foundIds } = await checkFormsInSheet(ids, 'the sheet sync');
  if (foundIds.length) console.log(`[Sheet] post-cast forms received: ${foundIds.join(', ')}`);
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
  // A main stream day's form ticks every match row of that day.
  const byMatch = new Map();
  for (const request of await allFormRequests()) {
    if (!['received', 'waived'].includes(postCastFormState(request))) continue;
    if ((Date.parse(request.postCastReminderSentAt || '') || 0) < sinceMs) continue;
    const targets = request.mainStream
      ? (request.matchIds || []).map((matchId, index) => ({ matchId, faceitUrl: request.faceitUrls?.[index] || null }))
      : [{ matchId: request.matchId, faceitUrl: request.faceitUrl }];
    for (const target of targets) {
      if (!target.matchId || !target.faceitUrl || byMatch.has(target.matchId)) continue;
      if (!sheetSyncDue(sync[`stats:${target.matchId}`], now)) continue;
      byMatch.set(target.matchId, { ...target, requestId: request.id });
    }
  }
  for (const target of [...byMatch.values()].slice(0, 10)) {
    const key = `stats:${target.matchId}`;
    const written = await scheduleSheet.markStatsCollected({ faceitLink: target.faceitUrl, matchId: target.matchId, requestId: target.requestId });
    if (written.ok) {
      await updateSheetSync(key, { doneAt: new Date(now).toISOString(), requestId: target.requestId });
      await appendAuditLog({ type: 'sheet_stats_collected', matchId: target.matchId, requestId: target.requestId }).catch(() => null);
    } else {
      await updateSheetSync(key, { nextCheckAt: laterIso(now, 6 * 60), error: written.error });
      console.warn(`[Sheet] Stats Collected for ${target.matchId} not ticked: ${written.error}`);
    }
  }
}

// --- Support tickets ------------------------------------------------------------------------------
// `/cf tickets` posts the "Open a ticket" panel. Picking a topic asks its questions (a form; Roster
// Change looks up the captain's team instead), then opens a private channel for the opener, staff and
// Tournament Operations with the answers in a header card. Staff can claim, reassign, change the
// priority and close; closing posts a transcript to Support Receipts and deletes the channel.
// Priority: a live / about-to-start match issue is urgent and pings the on-duty admins; a roster
// change is priority when the team's next FACEIT match is within 24 hours (bumped later if the match
// moves into that window); everything else is normal. Staff can override it.

const TICKET_BOT_PERMS = [
  PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ManageChannels
];
const TICKET_MEMBER_PERMS = [
  PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles
];
const APPLY_ROLES = ['Caster', 'Producer', 'Observer', 'Admin', 'Social Media', 'Other'];

async function postTicketPanel(interaction) {
  const channel = interaction.channel;
  if (!channel?.isTextBased?.()) {
    await interaction.reply({ content: 'Run this in the channel where the panel should go.', ephemeral: true });
    return;
  }
  // The panel just sits there: pressing Contact Support shows the topics privately, then the form,
  // and only then is the ticket channel made. Nothing is ever posted in the panel's channel.
  const embed = new EmbedBuilder()
    .setTitle('⚔️ CROSSFIRE SUPPORT ⚔️')
    .setDescription([
      'Need assistance? Our Crossfire Support Team is here to help you in real-time!',
      '',
      '🛠️ This is the official route for CROSSFIRE support.',
      '⬇️ Use the button below to open a support ticket.',
      '',
      'Please use tickets to contact staff members.'
    ].join('\n'))
    .setColor(0x2ecc71);
  const button = new ButtonBuilder().setCustomId('ticket_start').setLabel('Contact Support').setEmoji('📩').setStyle(ButtonStyle.Danger);
  await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] });
  await interaction.reply({ content: 'Ticket panel posted.', ephemeral: true });
}

// "Contact Support": the topic picker, visible only to the person who pressed it.
async function handleTicketStart(interaction) {
  if (config.ticketsStaffOnly && !isTicketStaff(interaction.member) && !isArenaTicketStaff(interaction.member)) {
    await interaction.reply({ content: 'The new ticket system is being tested by staff right now. For now, please use the usual ticket channel.', ephemeral: true });
    return;
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId('ticket_topic')
    .setPlaceholder('What do you need help with?')
    .addOptions(TICKET_TOPICS.map((topic) => ({ label: topic.label, description: topic.description.slice(0, 100), value: topic.key, emoji: topic.emoji })));
  await interaction.reply({
    content: 'What do you need help with? Pick a topic, answer a few questions, and a private ticket opens with the staff.',
    components: [new ActionRowBuilder().addComponents(select)],
    ephemeral: true
  });
}

function isTicketStaff(member) {
  return isAdminStaff(member) || canManageStreamRequests(member);
}

function ticketText(id, label, { style = TextInputStyle.Short, required = true, placeholder = null, max = 500 } = {}) {
  const input = new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(required).setMaxLength(max);
  if (placeholder) input.setPlaceholder(placeholder);
  return new LabelBuilder().setLabel(label).setTextInputComponent(input);
}

function ticketSelect(id, label, options, description = null) {
  const select = new StringSelectMenuBuilder().setCustomId(id).setRequired(true).setMinValues(1).setMaxValues(1)
    .addOptions(options.map((option) => (typeof option === 'string' ? { label: option, value: option } : option)));
  const labelled = new LabelBuilder().setLabel(label).setStringSelectMenuComponent(select);
  if (description) labelled.setDescription(description);
  return labelled;
}

function ticketModal(topicKey) {
  const modal = new ModalBuilder().setCustomId(`ticket_form:${topicKey}`);
  if (topicKey === 'support') {
    return modal.setTitle('General Support').addLabelComponents(
      ticketText('help', 'What do you need help with?', { style: TextInputStyle.Paragraph, max: 1500 }),
      ticketText('team', 'Your team (if it is about a team)', { required: false, max: 100 }),
      ticketText('link', 'Screenshot or link (optional)', { required: false, placeholder: 'You can also post screenshots in the ticket' })
    );
  }
  if (topicKey === 'match') {
    return modal.setTitle('Match / FACEIT Issue').addLabelComponents(
      ticketText('team', 'Your team', { max: 100 }),
      ticketText('match', 'Match link (FACEIT room)', { placeholder: 'https://www.faceit.com/en/cs2/room/...' }),
      ticketText('what', "What's happening?", { style: TextInputStyle.Paragraph, max: 1500 }),
      ticketSelect('state', 'Is the match live?', MATCH_STATES)
    );
  }
  if (topicKey === 'apply') {
    return modal.setTitle('Apply to Crossfire').addLabelComponents(
      ticketSelect('role', 'What are you applying for?', APPLY_ROLES),
      ticketText('experience', 'Relevant experience', { style: TextInputStyle.Paragraph, max: 1500 }),
      ticketText('links', 'Links (portfolio, channel, VODs…)', { required: false, style: TextInputStyle.Paragraph, max: 1000 })
    );
  }
  // Roster Change opened by staff for a team.
  return modal.setTitle('Roster Change').addLabelComponents(ticketText('team', 'Team name (as on the Roster Tracking tab)', { max: 100 }));
}

async function onDutyAdminIds(now = Date.now()) {
  const stored = await getCrewAvailability().catch(() => null);
  if (!stored?.data) return [];
  return crewPeopleWithIds(stored)
    .filter((person) => person.userId && (person.roles || []).includes('admin'))
    .filter((person) => ['free', 'partial'].includes(availabilityAt(person, now, 60).state))
    .map((person) => person.userId);
}

// The team's next FACEIT match: { ok: true, startMs, faceitUrl } (startMs null when none is
// scheduled), or { ok: false } when the schedule couldn't be read.
async function nextTeamMatch(team, now = Date.now()) {
  if (!faceit || !config.faceitApiKey) return { ok: false };
  let matches;
  try {
    matches = await loadSeasonMatches();
  } catch {
    return { ok: false };
  }
  const id = faceitTeamIdFromUrl(team.faceitUrl);
  const key = normalizeTeamKey(team.teamName);
  const upcoming = [];
  for (const match of matches) {
    if (/finished|cancel/i.test(String(match.status || ''))) continue;
    const ours = [match.raw?.teams?.faction1, match.raw?.teams?.faction2]
      .some((faction) => (id && faction?.faction_id === id) || (faction?.name && normalizeTeamKey(faction.name) === key));
    if (!ours) continue;
    const startMs = Date.parse(await approvedScheduleIso(match.id) || getFaceitScheduledAtIso(match) || '');
    if (Number.isFinite(startMs) && startMs >= now - 3 * 60 * 60 * 1000) upcoming.push({ startMs, faceitUrl: match.faceitUrl || null });
  }
  upcoming.sort((a, b) => a.startMs - b.startMs);
  return { ok: true, startMs: upcoming[0]?.startMs ?? null, faceitUrl: upcoming[0]?.faceitUrl || null };
}

function ticketControls(ticket) {
  if (ticket.status !== 'open') return [];
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ticket_claim:${ticket.id}`).setLabel(ticket.claimedBy ? 'Take over' : 'Claim').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`ticket_reassign:${ticket.id}`).setLabel('Reassign').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`ticket_close:${ticket.id}`).setLabel('Close').setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
      .setCustomId(`ticket_priority:${ticket.id}`)
      .setPlaceholder('Staff: change priority…')
      .addOptions(Object.entries(PRIORITIES).map(([value, entry]) => ({ label: entry.label, value, emoji: entry.emoji, default: ticket.priority === value }))))
  ];
}

// The Tournament Operations alert: the text, plus Claim (Take over once claimed) and a link to the
// ticket while it's open.
function ticketAlertPayload(ticket) {
  const components = [];
  if (ticket.status === 'open') {
    const buttons = [new ButtonBuilder().setCustomId(`ticket_claim:${ticket.id}`).setLabel(ticket.claimedBy ? 'Take over' : 'Claim').setStyle(ticket.claimedBy ? ButtonStyle.Secondary : ButtonStyle.Primary)];
    if (ticket.channelId && ticket.guildId) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open ticket').setURL(`https://discord.com/channels/${ticket.guildId}/${ticket.channelId}`));
    components.push(new ActionRowBuilder().addComponents(buttons));
  }
  return { content: ticketAlertText(ticket, { roleIds: ticketAlertRolesFor(ticket) }), components, allowedMentions: { parse: [] } };
}

// Arena tickets go to the Arena staff; everything else to Tournament Operations.
function ticketAlertRolesFor(ticket) {
  return ticket?.topic === 'arena' ? config.arenaTicketAlertRoleIds : config.ticketAlertRoleIds;
}

// Arena Admin / Arena Operations in the league server, or the Arena role in CROSSFIRE INTERNAL.
function isArenaTicketStaff(member) {
  return [...config.arenaTicketRoleIds, ...config.arenaTicketAlertRoleIds].some((roleId) => member?.roles?.cache?.has?.(roleId));
}

// Who can claim, reassign, set priority and close a ticket: staff, plus the Arena roles on Arena tickets.
function canHandleTicket(member, ticket) {
  return isTicketStaff(member) || (ticket?.topic === 'arena' && isArenaTicketStaff(member));
}

async function refreshTicketAlert(ticket) {
  if (!ticket?.alertChannelId || !ticket.alertMessageId) return;
  const channel = await client.channels.fetch(ticket.alertChannelId).catch(() => null);
  const message = channel?.isTextBased?.() ? await channel.messages.fetch(ticket.alertMessageId).catch(() => null) : null;
  if (message) await message.edit(ticketAlertPayload(ticket)).catch(() => null);
}

function ticketHeaderPayload(ticket) {
  const header = buildTicketHeader(ticket);
  return {
    embeds: [new EmbedBuilder().setTitle(header.title).setDescription(header.description).addFields(header.fields).setColor(header.color)],
    components: ticketControls(ticket)
  };
}

async function refreshTicketHeader(ticket) {
  const channel = ticket.channelId ? await client.channels.fetch(ticket.channelId).catch(() => null) : null;
  const message = channel?.isTextBased?.() && ticket.headerMessageId ? await channel.messages.fetch(ticket.headerMessageId).catch(() => null) : null;
  if (message) await message.edit(ticketHeaderPayload(ticket)).catch(() => null);
  return channel;
}

// Creates the ticket channel and its header. Returns { ticket, channel } or { error }.
async function openTicket({ guild, parentId, opener, topic, answers, priority, extra = {}, adminPings = false, note = null }) {
  const ticket = await createTicket({
    topic,
    openerId: opener.id,
    openerTag: opener.username,
    answers,
    priority: priority.priority,
    priorityReason: priority.reason || null,
    priorityOverride: false,
    needsVerify: Boolean(priority.needsVerify),
    guildId: guild.id,
    ...extra
  });
  await guild.roles.fetch().catch(() => null);
  const viewerRoleIds = [...(config.authorizedStaffRoleIds || []), ...(topic === 'arena' ? config.arenaTicketRoleIds : [])];
  const staffRoleIds = [...new Set(viewerRoleIds)].filter((roleId) => guild.roles.cache.has(roleId));
  const channel = await guild.channels.create({
    name: ticketChannelName(topic, ticket.number, opener.username, topic === 'arena' ? arenaTicketKind(ticket.arenaKind)?.prefix : null),
    type: ChannelType.GuildText,
    parent: config.ticketCategoryId || parentId || null,
    topic: `${ticketNumberText(ticket.number)} · ${ticketTopicLabel(ticket)} · opened by ${opener.username}`.slice(0, 1024),
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: client.user.id, allow: TICKET_BOT_PERMS },
      { id: opener.id, allow: TICKET_MEMBER_PERMS },
      ...staffRoleIds.map((roleId) => ({ id: roleId, allow: [...TICKET_MEMBER_PERMS, PermissionFlagsBits.ManageMessages] }))
    ]
  }).catch((error) => {
    console.error(`[Tickets] could not create the ticket channel: ${error.message || error}`);
    return null;
  });
  if (!channel) {
    await saveTicket(ticket.id, { status: 'failed' });
    return { error: "I couldn't create the ticket channel (missing Manage Channels permission?). Please tell a staff member." };
  }
  // Staff pings go in the alert channel, not the ticket: Tournament Operations always, plus the
  // on-duty admins (or the admin alert roles when nobody is marked free) for urgent tickets.
  let adminPingUserIds = [];
  let adminPingRoleIds = [];
  if (adminPings) {
    adminPingUserIds = await onDutyAdminIds();
    if (!adminPingUserIds.length) adminPingRoleIds = config.adminAlertRoleIds;
  }
  const content = [
    `<@${opener.id}>`,
    adminPings ? '🔴 **Priority support:** this match is live or about to start, and the admins have been alerted.' : null,
    note
  ].filter(Boolean).join(' ');
  const saved = await saveTicket(ticket.id, { channelId: channel.id, adminPingUserIds, adminPingRoleIds });
  const header = await channel.send({ content, ...ticketHeaderPayload(saved), allowedMentions: { parse: [], users: [opener.id] } }).catch(() => null);
  const final = await saveTicket(ticket.id, { headerMessageId: header?.id || null });
  // Tell Tournament Operations (and, if urgent, the on-duty admins) a ticket needs help.
  const alertChannelId = topic === 'arena' ? config.arenaTicketAlertChannelId : config.ticketAlertChannelId;
  const alertChannel = alertChannelId ? await client.channels.fetch(alertChannelId).catch(() => null) : null;
  let opened = final;
  if (alertChannel?.isTextBased?.()) {
    const alert = await alertChannel.send({
      ...ticketAlertPayload(final),
      allowedMentions: { parse: [], users: adminPingUserIds, roles: [...ticketAlertRolesFor(final), ...adminPingRoleIds] }
    }).catch((error) => {
      console.error(`[Tickets] alert for ${ticket.id} not posted: ${error.message || error}`);
      return null;
    });
    if (alert) opened = await saveTicket(ticket.id, { alertChannelId: alertChannel.id, alertMessageId: alert.id }) || final;
  }
  await appendAuditLog({ type: 'ticket_opened', ticketId: ticket.id, topic, actorId: opener.id, priority: priority.priority }).catch(() => null);
  return { ticket: opened, channel };
}

// The topic dropdown on the panel.
async function handleTicketTopic(interaction) {
  if (config.ticketsStaffOnly && !isTicketStaff(interaction.member) && !isArenaTicketStaff(interaction.member)) {
    await interaction.reply({ content: 'The new ticket system is being tested by staff right now. For now, please use the usual ticket channel.', ephemeral: true });
    return;
  }
  const topic = interaction.values?.[0];
  if (!ticketTopic(topic)) {
    await interaction.reply({ content: 'Pick a topic from the list.', ephemeral: true });
    return;
  }
  if (topic === 'arena') {
    const select = new StringSelectMenuBuilder()
      .setCustomId('ticket_arena_kind')
      .setPlaceholder('What is it about?')
      .addOptions(ARENA_TICKET_KINDS.map((kind) => ({ label: kind.label, description: kind.description.slice(0, 100), value: kind.value, emoji: kind.emoji })));
    await interaction.update({
      content: '🎮 **Arena / 10mans.** What is it about?',
      components: [new ActionRowBuilder().addComponents(select)]
    });
    return;
  }
  const open = (await listTickets({ status: 'open' })).find((ticket) => ticket.openerId === interaction.user.id && ticket.topic === topic);
  if (open?.channelId && await client.channels.fetch(open.channelId).catch(() => null)) {
    await interaction.reply({ content: `You already have an open ${ticketTopic(topic).label} ticket: <#${open.channelId}>.`, ephemeral: true });
    return;
  }
  if (topic !== 'roster' || isTicketStaff(interaction.member)) {
    await interaction.showModal(ticketModal(topic));
    return;
  }
  // Roster Change: only captains (staff get the form above to name the team).
  await interaction.deferReply({ ephemeral: true });
  const found = await resolveCaptainTeam(interaction.user, interaction.member);
  if (found.error) {
    await interaction.editReply(found.error);
    return;
  }
  const result = await openRosterTicket(interaction, found.team);
  await interaction.editReply(result.error || `Your roster change ticket is open: <#${result.channel.id}>`);
}

// Arena / 10mans: the second dropdown (what it's about) opens that kind's form.
async function handleArenaTicketKind(interaction) {
  if (config.ticketsStaffOnly && !isTicketStaff(interaction.member) && !isArenaTicketStaff(interaction.member)) {
    await interaction.reply({ content: 'The new ticket system is being tested by staff right now. For now, please use the usual ticket channel.', ephemeral: true });
    return;
  }
  const kind = arenaTicketKind(interaction.values?.[0]);
  if (!kind) {
    await interaction.reply({ content: 'Pick an option from the list.', ephemeral: true });
    return;
  }
  const open = (await listTickets({ status: 'open' })).find((ticket) => ticket.openerId === interaction.user.id && ticket.topic === 'arena' && ticket.arenaKind === kind.value);
  if (open?.channelId && await client.channels.fetch(open.channelId).catch(() => null)) {
    await interaction.reply({ content: `You already have an open **${kind.label}** ticket: <#${open.channelId}>.`, ephemeral: true });
    return;
  }
  await interaction.showModal(arenaTicketModal(kind.value));
}

function arenaTicketModal(kind) {
  const modal = new ModalBuilder().setCustomId(`ticket_form:arena:${kind}`);
  const matchLink = (required) => ticketText('match', required ? 'FACEIT match link' : 'FACEIT match link (if you have it)', { required, placeholder: 'https://www.faceit.com/en/cs2/room/...' });
  if (kind === 'report') {
    return modal.setTitle('Arena: Report a player').addLabelComponents(
      matchLink(true),
      ticketText('who', 'Who are you reporting? (FACEIT names)', { max: 200, placeholder: 'One or more names, separated by commas' }),
      ticketSelect('reason', 'Reason', ARENA_REPORT_REASONS),
      ticketText('what', 'What happened?', { style: TextInputStyle.Paragraph, max: 1500, placeholder: 'Round numbers / timestamps help a lot' }),
      ticketText('evidence', 'Clips or demo links (optional)', { required: false, style: TextInputStyle.Paragraph, max: 1000, placeholder: 'You can also post them in the ticket' })
    );
  }
  if (kind === 'live') {
    return modal.setTitle('Arena: Live game problem').addLabelComponents(
      matchLink(false),
      ticketSelect('problem', "What's wrong?", ARENA_LIVE_PROBLEMS),
      ticketText('details', 'Details', { style: TextInputStyle.Paragraph, max: 1000, required: false })
    );
  }
  if (kind === 'appeal') {
    return modal.setTitle('Arena: Appeal').addLabelComponents(
      ticketText('faceit', 'Your FACEIT name', { max: 120 }),
      ticketSelect('type', 'What are you appealing?', ARENA_APPEAL_TYPES),
      ticketText('when', 'When / which match (optional)', { required: false, max: 300, placeholder: 'Date, or the FACEIT match link' }),
      ticketText('why', 'Why should it be lifted?', { style: TextInputStyle.Paragraph, max: 1500 })
    );
  }
  return modal.setTitle('Arena: FACEIT link / voice help').addLabelComponents(
    ticketText('faceit', 'Your FACEIT name or profile link', { max: 120 }),
    ticketSelect('issue', "What's the problem?", ARENA_LINK_ISSUES),
    ticketText('details', 'Details (optional)', { style: TextInputStyle.Paragraph, max: 1000, required: false })
  );
}

// Reads the FACEIT match from a link: { line, teams, status, arena } or null.
async function arenaTicketMatch(link) {
  const room = parseFaceitMatchRoomLink(link);
  if (!room) return null;
  const raw = await faceit.getMatchRaw(room.matchId).catch(() => null);
  if (!raw) return { line: `${link} (couldn't read it on FACEIT)`, teams: [], status: null, arena: false };
  const arena = !config.arenaHubId || raw.competition_id === config.arenaHubId;
  const url = String(raw.faceit_url || link).replace('{lang}', 'en');
  return {
    line: `[${raw.competition_name || 'FACEIT match'}](${url}) · FACEIT: ${String(raw.status || 'unknown').toLowerCase()}${arena ? '' : ' · ⚠️ not an Arena Queue game'}`,
    teams: arenaTeams(raw),
    status: raw.status || null,
    arena
  };
}

async function openArenaTicket(interaction, kind, text, picked) {
  const links = await listArenaLinks().catch(() => ({}));
  const linkOf = (discordId) => Object.values(links).find((link) => link.discordId === discordId) || null;
  const mine = linkOf(interaction.user.id);
  const myLinkLine = mine ? `**${mine.nickname}** on FACEIT` : 'Not linked yet';
  let answers;
  let priority;
  if (kind === 'report' || kind === 'live') {
    const match = text('match') ? await arenaTicketMatch(text('match')) : null;
    const reported = kind === 'report' ? splitNames(text('who')) : [];
    const inMatch = new Set((match?.teams || []).flatMap((team) => team.players.map((player) => player.nickname.toLowerCase())));
    const notFound = match?.teams?.length ? reported.filter((name) => !inMatch.has(name.toLowerCase())) : [];
    priority = arenaTicketPriority({ kind, reason: picked('reason'), faceitStatus: match?.status || null });
    answers = kind === 'report'
      ? [
          { label: 'Reporting', value: reported.join(', ') + (notFound.length ? `\n⚠️ Not in that match: ${notFound.join(', ')}` : '') },
          { label: 'Reason', value: picked('reason') },
          { label: 'Match', value: match?.line || text('match') },
          { label: 'Players in that match', value: match?.teams?.length ? arenaMatchPlayersText(match.teams, links, reported) : '' },
          { label: 'What happened', value: text('what') },
          { label: 'Clips / demo', value: text('evidence') },
          { label: "Reporter's FACEIT", value: myLinkLine }
        ]
      : [
          { label: "What's wrong", value: picked('problem') },
          { label: 'Match', value: match?.line || text('match') || 'No link given' },
          { label: 'Players in that match', value: match?.teams?.length ? arenaMatchPlayersText(match.teams, links) : '' },
          { label: 'Details', value: text('details') },
          { label: "Opener's FACEIT", value: myLinkLine }
        ];
  } else if (kind === 'appeal') {
    priority = arenaTicketPriority({ kind });
    answers = [
      { label: 'Appealing', value: picked('type') },
      { label: 'FACEIT name', value: text('faceit') + (mine && mine.nickname.toLowerCase() !== text('faceit').replace(/^@/, '').toLowerCase() ? `\n⚠️ Their Discord is linked to **${mine.nickname}**` : '') },
      { label: 'When / which match', value: text('when') },
      { label: 'Why it should be lifted', value: text('why') }
    ];
  } else {
    priority = arenaTicketPriority({ kind });
    const typed = String(text('faceit') || '').trim();
    const nickname = (typed.match(/players\/([^/?#\s]+)/i)?.[1] || typed).replace(/^@/, '');
    const holder = Object.values(links).find((link) => link.nickname.toLowerCase() === nickname.toLowerCase());
    answers = [
      { label: 'Problem', value: picked('issue') },
      { label: 'FACEIT name they gave', value: typed },
      { label: 'Linked to them now', value: myLinkLine },
      { label: `Who has ${nickname || 'that FACEIT'} linked`, value: holder ? `<@${holder.discordId}> (${holder.source})` : 'Nobody' },
      { label: 'Details', value: text('details') },
      { label: 'Staff fix', value: '`/arena link faceit:<name> user:@them` moves a link; `/arena unlink` removes one.' }
    ];
  }
  const note = priority.priority === 'urgent' ? '🔴 **Live game:** Arena staff have been alerted and will jump in as soon as possible.' : null;
  return openTicket({
    guild: interaction.guild,
    parentId: interaction.channel?.parentId || null,
    opener: interaction.user,
    topic: 'arena',
    answers,
    priority,
    extra: { arenaKind: kind },
    note
  });
}

async function handleTicketForm(interaction) {
  const topic = interaction.customId.slice('ticket_form:'.length);
  await interaction.deferReply({ ephemeral: true });
  const text = (id) => {
    try {
      return interaction.fields.getTextInputValue(id)?.trim() || '';
    } catch {
      return '';
    }
  };
  const picked = (id) => {
    try {
      return [...(interaction.fields.getStringSelectValues(id) || [])][0] || '';
    } catch {
      return '';
    }
  };
  if (topic.startsWith('arena:')) {
    const result = await openArenaTicket(interaction, topic.slice('arena:'.length), text, picked);
    await interaction.editReply(result.error || `Your ticket is open: <#${result.channel.id}>`);
    return;
  }
  if (topic === 'roster') {
    const lookup = await scheduleSheet.readRosterTeam({ spreadsheetId: config.rosterSpreadsheetId, sheetName: config.rosterSheetName, teamName: text('team') });
    if (!lookup.ok) {
      await interaction.editReply(`Couldn't read the roster sheet: ${lookup.error}`);
      return;
    }
    if (!lookup.team) {
      await interaction.editReply(`No team called **${text('team')}** on the ${config.rosterSheetName} tab.`);
      return;
    }
    const result = await openRosterTicket(interaction, lookup.team);
    await interaction.editReply(result.error || `Roster change ticket opened: <#${result.channel.id}>`);
    return;
  }
  let answers;
  let priority = { priority: 'normal', reason: null };
  let adminPings = false;
  if (topic === 'support') {
    answers = [
      { label: 'What they need help with', value: text('help') },
      { label: 'Team', value: text('team') },
      { label: 'Screenshot or link', value: text('link') }
    ];
  } else if (topic === 'match') {
    const state = picked('state');
    const link = text('match');
    const room = parseFaceitMatchRoomLink(link);
    const match = room ? await faceit.getMatch(room.matchId).catch(() => null) : null;
    const result = matchIssuePriority({ state, faceitStatus: match?.status || null });
    priority = { priority: result.priority, reason: result.reason };
    adminPings = result.pingAdmins;
    answers = [
      { label: 'Team', value: text('team') },
      { label: 'Match', value: match ? `[${match.teamA} vs ${match.teamB}](${match.faceitUrl || link}) · FACEIT: ${String(match.status).toLowerCase()}` : link },
      { label: "What's happening", value: text('what') },
      { label: 'Match state', value: MATCH_STATES.find((entry) => entry.value === state)?.label || state }
    ];
  } else {
    answers = [
      { label: 'Applying for', value: picked('role') },
      { label: 'Discord', value: `<@${interaction.user.id}> (${interaction.user.username})` },
      { label: 'Experience', value: text('experience') },
      { label: 'Links', value: text('links') }
    ];
  }
  const result = await openTicket({
    guild: interaction.guild,
    parentId: interaction.channel?.parentId || null,
    opener: interaction.user,
    topic,
    answers,
    priority,
    adminPings
  });
  await interaction.editReply(result.error || `Your ticket is open: <#${result.channel.id}>`);
}

// --- Roster changes inside Roster Change tickets -------------------------------------------------
// The ticket shows the team, group and roster from the Roster Tracking tab. The captain (or staff)
// picks a player to remove, move to sub or promote, adds a new player as a starter, sub or coach, or
// changes the captain; the
// details form checks the fields; Confirm writes the sheet through the Apps Script, posts the change
// in the ticket and in Roster Change Requests (with "Done on FACEIT"). Wizard steps are ephemeral and
// live in memory for 30 minutes.

const ROSTER_WIZARD_MS = 30 * 60 * 1000;
const rosterWizards = new Map();

function isTeamCaptainMember(member) {
  if (!member?.roles?.cache) return false;
  if (config.teamCaptainRoleId && member.roles.cache.has(config.teamCaptainRoleId)) return true;
  const name = String(config.teamCaptainRoleName || '').toLowerCase();
  return Boolean(name) && member.roles.cache.some((role) => role.name.toLowerCase() === name);
}

async function captainMappingFor(userId) {
  return (await listTeamMappings(teamMappingScope())).find((mapping) => (mapping.captainDiscordIds || []).includes(userId)) || null;
}

// A captain's team on the Roster Tracking tab: from the team sync, or the team's Captain cell.
async function resolveCaptainTeam(user, member) {
  const mapping = await captainMappingFor(user.id);
  const lookup = await scheduleSheet.readRosterTeam({
    spreadsheetId: config.rosterSpreadsheetId,
    sheetName: config.rosterSheetName,
    faceitTeamId: mapping?.faceitTeamId || null,
    teamName: mapping?.teamName || null,
    captainDiscord: user.username
  });
  if (!lookup.ok) return { error: `Couldn't read the roster sheet: ${lookup.error}. Try again in a minute.` };
  if (!lookup.team) {
    return { error: mapping || isTeamCaptainMember(member)
      ? "Your team wasn't found on the roster sheet. Open a General Support ticket so an admin can check it."
      : 'Only team captains can request roster changes. If you are your team\'s captain, open a General Support ticket so an admin can fix the roster sheet.' };
  }
  if (!mapping && !lookup.team.isCaptain) {
    return { error: 'Only team captains can request roster changes, and you are not listed as the captain of a team on the roster sheet.' };
  }
  // The team sync may still list an old captain: once the sheet's Captain cell names another player
  // on the roster (after a captain change), only that player counts.
  if (mapping && !lookup.team.isCaptain) {
    const sheetCaptain = rosterCaptainSlot(lookup.team);
    if (sheetCaptain) {
      return { error: `The roster sheet lists **${sheetCaptain.alias}** as the captain of ${lookup.team.teamName}, so only they can request roster changes. If that's wrong, open a General Support ticket.` };
    }
  }
  return { team: lookup.team };
}

// The roster player the Captain cell names (by Discord or IGN), or null.
function rosterCaptainSlot(team) {
  const key = (value) => String(value || '').replace(/^@/, '').trim().toLowerCase();
  const captain = key(team?.captain);
  if (!captain) return null;
  return rosterSlots(team).find((slot) => slotTaken(slot) && [slot.discord, slot.alias].map(key).includes(captain)) || null;
}

// The server member for a roster slot's Discord cell (or a captain cell value), or null.
async function rosterMemberFor(guild, discordText) {
  const who = String(discordText || '').replace(/^@/, '').trim();
  if (!guild || !who) return null;
  const id = parseDiscordId(who) || await findMemberIdByName(guild, who).catch(() => null);
  return id ? guild.members.fetch(id).catch(() => null) : null;
}

// After a captain change: the Team Captain role moves from the old captain to the new one.
async function applyCaptainRoles({ guild, plan, record = null }) {
  if (!guild || !plan.captain) return [];
  await guild.roles.fetch().catch(() => null);
  const roleName = String(config.teamCaptainRoleName || '').toLowerCase();
  const role = (config.teamCaptainRoleId && guild.roles.cache.get(config.teamCaptainRoleId))
    || guild.roles.cache.find((entry) => roleName && entry.name.toLowerCase() === roleName) || null;
  if (!role) return ['⚠️ No Team Captain role was found, so captain roles weren\'t changed.'];
  const lines = [];
  const next = await rosterMemberFor(guild, plan.captain.slot.discord);
  if (!next) {
    lines.push(`⚠️ Couldn't find ${plan.captain.slot.alias} in this server from the sheet's Discord cell, so give them **${role.name}** by hand.`);
  } else if (!next.roles.cache.has(role.id)) {
    const ok = await next.roles.add(role, 'Roster change: made team captain').then(() => true).catch(() => false);
    if (ok) record?.push({ userId: next.id, roleIds: [role.id], action: 'add' });
    lines.push(ok ? `🎭 Gave <@${next.id}> **${role.name}**.` : `⚠️ Couldn't give <@${next.id}> **${role.name}** (the bot's role must be above it).`);
  }
  const oldText = plan.captain.oldSlot?.discord || plan.captain.oldValue;
  const old = oldText ? await rosterMemberFor(guild, oldText) : null;
  if (old && old.id !== next?.id && old.roles.cache.has(role.id)) {
    const ok = await old.roles.remove(role, 'Roster change: no longer team captain').then(() => true).catch(() => false);
    if (ok) record?.push({ userId: old.id, roleIds: [role.id], action: 'remove' });
    lines.push(ok ? `🎭 Removed **${role.name}** from <@${old.id}>.` : `⚠️ Couldn't remove **${role.name}** from <@${old.id}> (the bot's role must be above it).`);
  } else if (oldText && !old) {
    lines.push(`⚠️ Couldn't find the old captain (${plan.captain.oldSlot?.alias || oldText}) in this server, so remove their **${role.name}** role by hand if they have it.`);
  }
  return lines;
}

// After a confirmed roster change: the new player gets the team role and Season Participant role;
// a removed player loses the team role, and Season Participant too unless they're on another team.
// Returns lines for the captain and the admin post.
async function applyRosterRoles({ guild, team, player, removedSlot, record = null }) {
  if (!guild) return [];
  await guild.roles.fetch().catch(() => null);
  const mappings = await listTeamMappings(teamMappingScope());
  const teamId = faceitTeamIdFromUrl(team.faceitUrl);
  const key = normalizeTeamKey(team.teamName);
  const mapping = mappings.find((entry) => (teamId && entry.faceitTeamId === teamId))
    || mappings.find((entry) => [entry.teamName, ...(entry.aliases || [])].some((name) => normalizeTeamKey(name) === key));
  const teamRoleId = mapping?.discordRoleId || config.teamRoleIds?.get?.(key) || null;
  const teamRole = teamRoleId ? guild.roles.cache.get(teamRoleId) : null;
  const participantName = String(config.seasonParticipantRoleName || '').toLowerCase();
  const participantRole = (config.seasonParticipantRoleId && guild.roles.cache.get(config.seasonParticipantRoleId))
    || guild.roles.cache.find((role) => participantName && role.name.toLowerCase() === participantName) || null;
  const lines = [];
  if (!teamRole) lines.push(`⚠️ No Discord role is linked to ${team.teamName}, so the team role wasn't changed (run \`/cf sync target:teams\`).`);

  if (player?.discordId) {
    const member = await guild.members.fetch(player.discordId).catch(() => null);
    if (!member) {
      lines.push(`⚠️ ${player.alias} isn't in this server, so they didn't get their roles. They'll need them when they join.`);
    } else {
      const add = [teamRole, participantRole].filter((role) => role && !member.roles.cache.has(role.id));
      if (add.length) {
        const ok = await member.roles.add(add, `Roster change: added to ${team.teamName}`).then(() => true).catch(() => false);
        if (ok) record?.push({ userId: member.id, roleIds: add.map((role) => role.id), action: 'add' });
        lines.push(ok ? `🎭 Gave <@${member.id}> ${add.map((role) => `**${role.name}**`).join(' and ')}.` : `⚠️ Couldn't give <@${member.id}> their roles (the bot's role must be above them).`);
      }
    }
  }

  if (removedSlot && teamRole) {
    const who = String(removedSlot.discord || '').replace(/^@/, '').trim();
    const removedId = parseDiscordId(who) || (who ? await findMemberIdByName(guild, who).catch(() => null) : null);
    const member = removedId ? await guild.members.fetch(removedId).catch(() => null) : null;
    if (!member) {
      lines.push(`⚠️ Couldn't find ${removedSlot.alias || 'the removed player'} in this server from the sheet's Discord cell, so remove their **${teamRole.name}** role by hand.`);
    } else if (!player?.discordId || member.id !== player.discordId) {
      const otherTeamRoleIds = new Set(mappings.map((entry) => entry.discordRoleId).filter((roleId) => roleId && roleId !== teamRole.id));
      const onOtherTeam = member.roles.cache.some((role) => otherTeamRoleIds.has(role.id));
      const remove = [teamRole, onOtherTeam ? null : participantRole].filter((role) => role && member.roles.cache.has(role.id));
      if (remove.length) {
        const ok = await member.roles.remove(remove, `Roster change: removed from ${team.teamName}`).then(() => true).catch(() => false);
        if (ok) record?.push({ userId: member.id, roleIds: remove.map((role) => role.id), action: 'remove' });
        lines.push(ok ? `🎭 Removed ${remove.map((role) => `**${role.name}**`).join(' and ')} from <@${member.id}>.` : `⚠️ Couldn't remove <@${member.id}>'s roles (the bot's role must be above them).`);
      }
    }
  }
  return lines;
}

// The team's group, from FACEIT's season matches (Group C), or null.
async function rosterTeamGroup(team) {
  const id = faceitTeamIdFromUrl(team.faceitUrl);
  const key = normalizeTeamKey(team.teamName);
  const matches = await loadSeasonMatches().catch(() => []);
  const hit = matches.find((match) => match.group && [match.raw?.teams?.faction1, match.raw?.teams?.faction2]
    .some((faction) => (id && faction?.faction_id === id) || (faction?.name && normalizeTeamKey(faction.name) === key)));
  return hit?.group || null;
}

function rosterListText(team) {
  return rosterSlots(team).map((slot) => slotText(slot)).join('\n') || 'No players on the sheet yet.';
}

async function openRosterTicket(interaction, team) {
  const next = await nextTeamMatch(team);
  const priority = rosterPriority(next);
  const group = await rosterTeamGroup(team);
  const nextText = !next.ok ? 'Unknown (could not read the schedule)' : next.startMs ? `<t:${Math.floor(next.startMs / 1000)}:F> (<t:${Math.floor(next.startMs / 1000)}:R>)` : 'None scheduled';
  const result = await openTicket({
    guild: interaction.guild,
    parentId: interaction.channel?.parentId || null,
    opener: interaction.user,
    topic: 'roster',
    answers: [
      { label: 'Team', value: team.teamName },
      { label: 'Group', value: group || 'Unknown' },
      { label: 'Next match', value: nextText }
    ],
    priority,
    extra: {
      teamName: team.teamName,
      teamFaceitUrl: team.faceitUrl || null,
      group,
      nextMatchIso: next.startMs ? new Date(next.startMs).toISOString() : null,
      nextMatchCheckedAt: new Date().toISOString()
    }
  });
  if (result.error) return result;
  await result.channel.send(rosterPanelPayload(result.ticket, team)).catch(() => null);
  if (priority.needsVerify) {
    await result.channel.send({ content: `<@${interaction.user.id}> I couldn't read your team's schedule. Please reply here with your **next match link** and **start time** so staff can check whether this needs to be done first.`, allowedMentions: { users: [interaction.user.id] } }).catch(() => null);
  }
  return result;
}

function rosterPanelPayload(ticket, team) {
  const slots = rosterSlots(team).filter(slotTaken);
  const embed = new EmbedBuilder()
    .setTitle(`🔁 ${team.teamName} roster`)
    .setDescription([
      '**Current roster** (from the Roster Tracking tab)',
      rosterListText(team),
      '',
      `**Captain:** ${rosterCaptainSlot(team)?.alias || team.captain || 'not set'}`,
      '',
      'Pick a player to remove, move to sub or promote, add a new player or coach, or change the captain.'
    ].join('\n').slice(0, 4000))
    .setColor(0x5865f2);
  const rows = [];
  if (slots.length) {
    rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
      .setCustomId(`troster_pick:${ticket.id}`)
      .setPlaceholder('Pick a player to change…')
      .addOptions(slots.map((slot) => ({ label: slotText(slot).slice(0, 100), value: slot.label })))));
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`troster_add:${ticket.id}`).setLabel('Add a new player').setStyle(ButtonStyle.Success),
    ...(slots.length ? [new ButtonBuilder().setCustomId(`troster_captain:${ticket.id}`).setLabel('Change captain').setStyle(ButtonStyle.Primary)] : []),
    new ButtonBuilder().setCustomId(`troster_reload:${ticket.id}`).setLabel('Reload roster').setStyle(ButtonStyle.Secondary)
  ));
  return { embeds: [embed], components: rows };
}

async function freshRosterTeam(ticket) {
  const lookup = await scheduleSheet.readRosterTeam({
    spreadsheetId: config.rosterSpreadsheetId,
    sheetName: config.rosterSheetName,
    faceitTeamId: faceitTeamIdFromUrl(ticket.teamFaceitUrl),
    teamName: ticket.teamName
  });
  if (!lookup.ok) return { error: `Couldn't read the roster sheet: ${lookup.error}` };
  if (!lookup.team) return { error: `${ticket.teamName} isn't on the ${config.rosterSheetName} tab any more.` };
  return { team: lookup.team };
}

// Whether the person being added is the coach (HLTV is optional for coaches).
function rosterAddingCoach(wizard) {
  const change = wizard?.change || {};
  return change.kind === 'add' ? change.joinAs === 'coach' : change.kind === 'remove' && isCoachSlot(change.slotLabel);
}

// Page 1: the FACEIT link (IGN, SteamID64 and country come from FACEIT), Discord user, full name,
// HLTV and Twitter.
function rosterPlayerModalA(wizard) {
  const values = wizard.draft || {};
  const coach = rosterAddingCoach(wizard);
  const text = (id, label, value, placeholder, { required = true, max = 200, description = null } = {}) => {
    const input = new TextInputBuilder().setCustomId(id).setStyle(TextInputStyle.Short).setRequired(required).setMaxLength(max).setPlaceholder(placeholder);
    if (value) input.setValue(String(value).slice(0, max));
    const labelled = new LabelBuilder().setLabel(label).setTextInputComponent(input);
    if (description) labelled.setDescription(description);
    return labelled;
  };
  const picker = new UserSelectMenuBuilder().setCustomId('discordUser').setRequired(false).setMinValues(0).setMaxValues(1);
  if (values.pickedId) picker.setDefaultUsers(values.pickedId);
  return new ModalBuilder()
    .setCustomId(`troster_formA:${wizard.ticketId}`)
    .setTitle(coach ? 'New coach' : 'New player')
    .addLabelComponents(
      text('faceit', 'FACEIT profile link', values.faceitInput, 'https://www.faceit.com/en/players/...', { description: 'Their IGN, SteamID64 and country are filled in from FACEIT.' }),
      new LabelBuilder().setLabel('Discord user').setDescription("Not in this server? Leave empty; you'll be asked for their ID.").setUserSelectMenuComponent(picker),
      text('fullName', 'Full name', values.fullName, 'First and last name', { max: 100 }),
      coach
        ? text('hltv', 'HLTV profile link (optional for coaches)', values.hltv, 'https://www.hltv.org/coach/...', { required: false })
        : text('hltv', 'HLTV profile link', values.hltv, 'https://www.hltv.org/player/...'),
      text('twitter', 'Twitter / X (optional)', values.twitterInput, '@handle or link', { required: false, max: 100 })
    );
}

// Page 2, only when needed: their Discord ID (not in the server), and IGN / SteamID64 / nationality
// typed by hand when FACEIT couldn't be reached or has no Steam account linked.
function rosterPlayerModalB(wizard) {
  const values = wizard.draft || {};
  const need = wizard.pageTwo || {};
  const text = (id, label, value, placeholder, max = 100) => {
    const input = new TextInputBuilder().setCustomId(id).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(max).setPlaceholder(placeholder);
    if (value) input.setValue(String(value).slice(0, max));
    return new LabelBuilder().setLabel(label).setTextInputComponent(input);
  };
  const fields = [];
  if (need.discordId) fields.push(text('discordIdTyped', 'Their Discord ID (17-20 digits)', values.typedDiscordId, 'Developer Mode → right-click → Copy User ID', 25));
  if (need.manual) {
    fields.push(text('alias', 'In-game name (IGN)', values.alias, 'In-game name', 64));
    fields.push(text('nationality', 'Nationality', values.nationality, 'e.g. United States', 60));
  }
  if (need.manual || need.steamId) fields.push(text('steamId', 'SteamID64', values.steamId, '7656119xxxxxxxxxx', 25));
  return new ModalBuilder().setCustomId(`troster_formB:${wizard.ticketId}`).setTitle('New player: a few more details').addLabelComponents(...fields);
}

// Checks the draft once every page is in. Shows errors with fix buttons, or moves on to confirm.
async function finishRosterPlayer(interaction, wizard, ticket) {
  const draft = wizard.draft || {};
  const typed = draft.typedDiscordId ? parseDiscordId(draft.typedDiscordId) : null;
  const checked = validateNewPlayer({
    alias: draft.alias, fullName: draft.fullName, faceit: draft.faceit || draft.faceitInput, hltv: draft.hltv, steamId: draft.steamId,
    nationality: draft.nationality, twitter: draft.twitterInput,
    discordId: draft.pickedId || typed, discord: draft.pickedName || typed || ''
  }, { hltvOptional: rosterAddingCoach(wizard) });
  if (draft.typedDiscordId && !typed && !draft.pickedId) checked.errors.push('Discord ID must be 17–20 digits (Developer Mode → right-click them → Copy User ID).');
  if (checked.errors.length) {
    wizard.player = null;
    const buttons = [new ButtonBuilder().setCustomId(`troster_formA_open:${wizard.ticketId}`).setLabel('Fix the details').setStyle(ButtonStyle.Primary)];
    if (Object.values(wizard.pageTwo || {}).some(Boolean)) buttons.push(new ButtonBuilder().setCustomId(`troster_formB_open:${wizard.ticketId}`).setLabel('Fix page 2').setStyle(ButtonStyle.Primary));
    buttons.push(new ButtonBuilder().setCustomId(`troster_cancel:${wizard.ticketId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary));
    await interaction.editReply({ content: ['Some details need fixing:', ...checked.errors.map((error) => `• ${error}`), '', 'Your answers are kept.'].join('\n'), embeds: [], components: [new ActionRowBuilder().addComponents(buttons)] });
    return;
  }
  // The same player on another team (or already on this one): captains are stopped, staff are warned.
  const found = await scheduleSheet.findRosterPlayer({
    spreadsheetId: config.rosterSpreadsheetId,
    sheetName: config.rosterSheetName,
    steamId: checked.player.steamId,
    faceit: checked.player.faceit,
    discord: checked.player.discord
  }).catch((error) => ({ ok: false, error: error.message || String(error), matches: [] }));
  const replacing = wizard.change.kind === 'remove' ? wizard.change.slotLabel : null;
  const duplicates = (found.matches || []).filter((match) => !(replacing && match.label === replacing && normalizeTeamKey(match.teamName) === normalizeTeamKey(ticket.teamName)));
  wizard.duplicates = duplicates;
  wizard.duplicateCheckFailed = !found.ok;
  if (duplicates.length && !isTicketStaff(interaction.member)) {
    wizard.player = null;
    await interaction.editReply({
      content: [
        `**${checked.player.alias}** is already on the roster sheet:`,
        ...duplicatePlayerLines(duplicates),
        '',
        'A player can only be on one team. If they are leaving that team, its captain has to remove them first (or ask the staff in this ticket). Wrong player? Fix the details.'
      ].join('\n'),
      embeds: [],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`troster_formA_open:${wizard.ticketId}`).setLabel('Fix the details').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`troster_cancel:${wizard.ticketId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
      )]
    });
    return;
  }
  wizard.player = { ...checked.player, fromFaceit: Boolean(draft.fromFaceit) };
  await rosterWizardNext(interaction, wizard, ticket, { update: false });
}

function wizardKey(ticketId, userId) {
  return `${ticketId}:${userId}`;
}

function rosterWizardFor(ticketId, userId, { create = false } = {}) {
  const key = wizardKey(ticketId, userId);
  const now = Date.now();
  for (const [entryKey, entry] of rosterWizards) if (now - entry.startedAt > ROSTER_WIZARD_MS) rosterWizards.delete(entryKey);
  if (!rosterWizards.has(key) && create) rosterWizards.set(key, { ticketId, userId, startedAt: now, change: {}, player: null });
  return rosterWizards.get(key) || null;
}

function rosterConfirmView(wizard, plan) {
  const lines = [plan.summary, plan.warning ? `\n⚠️ ${plan.warning}` : null];
  const adding = wizard.player && !['promote', 'captain'].includes(wizard.change.kind);
  if (adding) {
    lines.push('', '**New player**', ...playerLines(wizard.player));
    if (wizard.player.fromFaceit) lines.push('*IGN, SteamID64 and nationality are from their FACEIT profile.*');
    if (wizard.duplicates?.length) lines.push('', '⚠️ **Already on the roster sheet** (staff can still confirm):', ...duplicatePlayerLines(wizard.duplicates));
    else if (wizard.duplicateCheckFailed) lines.push('', "⚠️ Couldn't check whether this player is on another team.");
  }
  return {
    content: '',
    embeds: [new EmbedBuilder().setTitle('Confirm roster change').setDescription(lines.filter((line) => line !== null).join('\n').slice(0, 4000)).setColor(plan.warning ? 0xf1c40f : 0x5865f2)],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`troster_confirm:${wizard.ticketId}`).setLabel('Confirm').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`troster_cancel:${wizard.ticketId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    )]
  };
}

// Shows the next step of the wizard: the player form, a swap pick, or the confirm view.
async function rosterWizardNext(interaction, wizard, ticket, { update = true } = {}) {
  // Reading the sheet can take longer than Discord's 3 seconds, so acknowledge the click first.
  if (update && interaction.isMessageComponent?.() && !interaction.deferred && !interaction.replied) await interaction.deferUpdate();
  const respond = (payload) => interaction.editReply(payload);
  const fresh = await freshRosterTeam(ticket);
  if (fresh.error) return respond({ content: fresh.error, embeds: [], components: [] });
  if (wizard.needsPlayer && !wizard.player) {
    return respond({
      content: 'Fill in the new player. Paste their FACEIT link and the bot fills in their IGN, SteamID64 and nationality.',
      embeds: [],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`troster_formA_open:${wizard.ticketId}`).setLabel('Fill in the new player').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`troster_cancel:${wizard.ticketId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
      )]
    });
  }
  const plan = planRosterOps(fresh.team, { ...wizard.change, player: ['promote', 'captain'].includes(wizard.change.kind) ? null : wizard.player });
  if (!plan.ok && plan.needsSwap) {
    const starters = rosterSlots(fresh.team).filter((slot) => isStarterSlot(slot.label) && slotTaken(slot));
    return respond({
      content: plan.error,
      embeds: [],
      components: [
        new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`troster_swap:${wizard.ticketId}`).setPlaceholder('Starter who moves to sub…')
          .addOptions(starters.map((slot) => ({ label: slotText(slot).slice(0, 100), value: slot.label })))),
        new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`troster_cancel:${wizard.ticketId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary))
      ]
    });
  }
  if (!plan.ok) return respond({ content: `⚠️ ${plan.error}`, embeds: [], components: [] });
  wizard.team = fresh.team;
  return respond(rosterConfirmView(wizard, plan));
}

async function handleTicketRoster(interaction) {
  const [kind, ticketId, extra] = interaction.customId.split(':');
  const ticket = await getTicket(ticketId);
  if (!ticket || ticket.status !== 'open' || ticket.topic !== 'roster') {
    await interaction.reply({ content: 'This ticket is closed.', ephemeral: true });
    return;
  }
  if (interaction.user.id !== ticket.openerId && !isTicketStaff(interaction.member)) {
    await interaction.reply({ content: 'Only the captain who opened this ticket (or staff) can change the roster here.', ephemeral: true });
    return;
  }

  if (kind === 'troster_reload') {
    await interaction.deferUpdate();
    const fresh = await freshRosterTeam(ticket);
    if (!fresh.error) await interaction.message.edit(rosterPanelPayload(ticket, fresh.team)).catch(() => null);
    else await interaction.followUp({ content: fresh.error, ephemeral: true });
    return;
  }
  if (kind === 'troster_pick') {
    const wizard = rosterWizardFor(ticketId, interaction.user.id, { create: true });
    wizard.change = { slotLabel: interaction.values?.[0] };
    wizard.player = null;
    await interaction.deferReply({ ephemeral: true });
    const fresh = await freshRosterTeam(ticket);
    const slot = fresh.team ? rosterSlots(fresh.team).find((entry) => entry.label === wizard.change.slotLabel) : null;
    if (!slot || !slotTaken(slot)) {
      await interaction.editReply({ content: fresh.error || 'That player is not on the sheet any more. Press Reload roster.' });
      return;
    }
    const buttons = [new ButtonBuilder().setCustomId(`troster_kind:${ticketId}:remove`).setLabel(isCoachSlot(slot.label) ? 'Remove as coach' : 'Remove from team').setStyle(ButtonStyle.Danger)];
    // The coach can only be removed (or replaced).
    if (isStarterSlot(slot.label)) buttons.push(new ButtonBuilder().setCustomId(`troster_kind:${ticketId}:sub`).setLabel('Move to sub').setStyle(ButtonStyle.Primary));
    else if (!isCoachSlot(slot.label)) buttons.push(new ButtonBuilder().setCustomId(`troster_kind:${ticketId}:promote`).setLabel('Promote to starter').setStyle(ButtonStyle.Primary));
    buttons.push(new ButtonBuilder().setCustomId(`troster_cancel:${ticketId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary));
    await interaction.editReply({ content: `**${slotText(slot)}**: what happens to them?`, components: [new ActionRowBuilder().addComponents(buttons)] });
    return;
  }
  if (kind === 'troster_add') {
    const wizard = rosterWizardFor(ticketId, interaction.user.id, { create: true });
    wizard.change = { kind: 'add' };
    wizard.player = null;
    await interaction.reply({
      content: 'Is the new player joining as a starter, a sub or the coach?',
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`troster_join:${ticketId}:starter`).setLabel('Starter').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`troster_join:${ticketId}:sub`).setLabel('Sub').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`troster_join:${ticketId}:coach`).setLabel('Coach').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`troster_cancel:${ticketId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
      )],
      ephemeral: true
    });
    return;
  }
  if (kind === 'troster_captain') {
    await interaction.deferReply({ ephemeral: true });
    const fresh = await freshRosterTeam(ticket);
    if (fresh.error) {
      await interaction.editReply({ content: fresh.error });
      return;
    }
    const current = rosterCaptainSlot(fresh.team);
    const choices = rosterSlots(fresh.team).filter((slot) => slotTaken(slot) && slot.label !== current?.label);
    if (!choices.length) {
      await interaction.editReply({ content: 'There is no one else on the roster to make captain.' });
      return;
    }
    const wizard = rosterWizardFor(ticketId, interaction.user.id, { create: true });
    wizard.change = { kind: 'captain' };
    wizard.player = null;
    wizard.needsPlayer = false;
    await interaction.editReply({
      content: `Who is the new captain? (now: **${current?.alias || fresh.team.captain || 'not set'}**)`,
      components: [
        new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`troster_captainpick:${ticketId}`).setPlaceholder('New captain…')
          .addOptions(choices.map((slot) => ({ label: slotText(slot).slice(0, 100), value: slot.label })))),
        new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`troster_cancel:${ticketId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary))
      ]
    });
    return;
  }

  const wizard = rosterWizardFor(ticketId, interaction.user.id);
  if (!wizard) {
    const content = 'This step timed out. Start again from the roster in this ticket.';
    if (interaction.isMessageComponent()) await interaction.update({ content, embeds: [], components: [] });
    else await interaction.reply({ content, ephemeral: true });
    return;
  }

  if (kind === 'troster_cancel') {
    rosterWizards.delete(wizardKey(ticketId, interaction.user.id));
    await interaction.update({ content: 'Cancelled. Nothing was changed.', embeds: [], components: [] });
    return;
  }
  if (kind === 'troster_captainpick') {
    wizard.change = { kind: 'captain', slotLabel: interaction.values?.[0] };
    await rosterWizardNext(interaction, wizard, ticket);
    return;
  }
  if (kind === 'troster_join') {
    wizard.change.joinAs = ['sub', 'coach'].includes(extra) ? extra : 'starter';
    wizard.needsPlayer = true;
    await rosterWizardNext(interaction, wizard, ticket);
    return;
  }
  if (kind === 'troster_kind') {
    wizard.change.kind = extra;
    if (extra === 'promote') {
      wizard.needsPlayer = false;
      await rosterWizardNext(interaction, wizard, ticket);
      return;
    }
    await interaction.update({
      content: extra === 'remove' ? (isCoachSlot(wizard.change.slotLabel) ? 'Add a new coach in their place?' : 'Add a new player in their slot?') : 'Add a new player in their starter slot?',
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`troster_replace:${ticketId}:yes`).setLabel('Yes, add a player').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`troster_replace:${ticketId}:no`).setLabel('No, just this change').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`troster_cancel:${ticketId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
      )]
    });
    return;
  }
  if (kind === 'troster_replace') {
    wizard.needsPlayer = extra === 'yes';
    await rosterWizardNext(interaction, wizard, ticket);
    return;
  }
  if (kind === 'troster_swap') {
    wizard.change.swapLabel = interaction.values?.[0];
    await rosterWizardNext(interaction, wizard, ticket);
    return;
  }
  if (kind === 'troster_formA_open') {
    await interaction.showModal(rosterPlayerModalA(wizard));
    return;
  }
  if (kind === 'troster_formB_open') {
    await interaction.showModal(rosterPlayerModalB(wizard));
    return;
  }
  if (kind === 'troster_formA') {
    await interaction.deferUpdate();
    const pickedUser = (() => {
      try {
        return interaction.fields.getSelectedUsers('discordUser')?.first() || null;
      } catch {
        return null;
      }
    })();
    const faceitInput = interaction.fields.getTextInputValue('faceit').trim();
    const draft = {
      ...(wizard.draft || {}),
      faceitInput,
      fullName: interaction.fields.getTextInputValue('fullName'),
      hltv: interaction.fields.getTextInputValue('hltv'),
      twitterInput: interaction.fields.getTextInputValue('twitter') || '',
      pickedId: pickedUser?.id || null,
      pickedName: pickedUser?.username || null
    };
    wizard.draft = draft;
    const fixButtons = () => new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`troster_formA_open:${ticketId}`).setLabel('Fix the details').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`troster_cancel:${ticketId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    );
    const nickname = faceitNicknameFromUrl(faceitInput);
    if (!nickname) {
      await interaction.editReply({ content: 'That FACEIT link isn\'t a player profile. It should look like `https://www.faceit.com/en/players/<name>`.', embeds: [], components: [fixButtons()] });
      return;
    }
    let found;
    let faceitDown = false;
    try {
      found = faceit && config.faceitApiKey ? playerFromFaceit(await faceit.getPlayerByNickname(nickname)) : null;
      if (!faceit || !config.faceitApiKey) faceitDown = true;
    } catch {
      faceitDown = true;
    }
    if (!found && !faceitDown) {
      await interaction.editReply({ content: `There's no FACEIT player called **${nickname}**. Check the link (open it in a browser to be sure).`, embeds: [], components: [fixButtons()] });
      return;
    }
    if (found) Object.assign(draft, { alias: found.alias, steamId: found.steamId || draft.steamId || '', nationality: found.nationality || draft.nationality || '', faceit: found.faceit, fromFaceit: true });
    else Object.assign(draft, { faceit: faceitInput, fromFaceit: false });
    wizard.pageTwo = { discordId: !draft.pickedId, manual: faceitDown, steamId: Boolean(found) && !found.steamId };
    if (Object.values(wizard.pageTwo).some(Boolean)) {
      const why = [
        found ? `Found **${found.alias}** on FACEIT${found.nationality ? ` (${found.nationality})` : ''}.` : "Couldn't reach FACEIT, so type their IGN, SteamID64 and nationality.",
        wizard.pageTwo.steamId ? 'Their FACEIT has no Steam account linked, so type their SteamID64.' : null,
        wizard.pageTwo.discordId ? "They weren't picked from this server, so type their Discord ID." : null
      ].filter(Boolean).join('\n');
      await interaction.editReply({
        content: why,
        embeds: [],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`troster_formB_open:${ticketId}`).setLabel('Next').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`troster_cancel:${ticketId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
        )]
      });
      return;
    }
    await finishRosterPlayer(interaction, wizard, ticket);
    return;
  }
  if (kind === 'troster_formB') {
    await interaction.deferUpdate();
    const value = (id) => {
      try {
        return interaction.fields.getTextInputValue(id) || '';
      } catch {
        return null;
      }
    };
    const draft = wizard.draft || {};
    for (const [field, id] of [['typedDiscordId', 'discordIdTyped'], ['alias', 'alias'], ['nationality', 'nationality'], ['steamId', 'steamId']]) {
      const typed = value(id);
      if (typed !== null) draft[field] = typed;
    }
    wizard.draft = draft;
    await finishRosterPlayer(interaction, wizard, ticket);
    return;
  }
  if (kind === 'troster_confirm') {
    await interaction.update({ content: 'Saving to the roster sheet…', embeds: [], components: [] });
    const fresh = await freshRosterTeam(ticket);
    if (fresh.error) {
      await interaction.editReply({ content: fresh.error });
      return;
    }
    const player = ['promote', 'captain'].includes(wizard.change.kind) ? null : wizard.player;
    const plan = planRosterOps(fresh.team, { ...wizard.change, player });
    const removedSlot = wizard.change.kind === 'remove' ? rosterSlots(fresh.team).find((slot) => slot.label === wizard.change.slotLabel) || null : null;
    if (!plan.ok) {
      await interaction.editReply({ content: `⚠️ ${plan.error} Start again from the roster.` });
      return;
    }
    // The sheet call also adds the Roster History rows, so a change sent to an admin (subs full,
    // nothing written to the roster) still goes in the history.
    let historyWarning = null;
    let written = null;
    if (plan.sheetChange || plan.history?.length) {
      written = await scheduleSheet.applyRosterOps({
        spreadsheetId: config.rosterSpreadsheetId,
        sheetName: config.rosterSheetName,
        teamName: fresh.team.teamName,
        headerRow: fresh.team.headerRow,
        expect: plan.sheetChange ? plan.expect : [],
        expectCaptain: plan.expectCaptain ?? null,
        ops: plan.sheetChange ? plan.ops : [],
        linkLabel: config.rosterLinkLabel,
        logLine: plan.sheetChange ? plan.logLine : null,
        history: plan.history || [],
        historySheetName: config.rosterHistorySheetName,
        requestedBy: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
        when: new Date().toISOString(),
        whenText: historyWhenText(new Date(), config.defaultTimezone)
      });
      if (!written.ok && plan.sheetChange) {
        await appendAuditLog({ type: 'roster_change_failed', ticketId, actorId: interaction.user.id, error: written.error }).catch(() => null);
        await interaction.editReply({ ...rosterConfirmView(wizard, plan), content: `❌ The roster sheet couldn't be updated: ${written.error}\nNothing was sent to the admins. Press Confirm to try again, or Cancel.` });
        return;
      }
      if (!written.ok) historyWarning = `⚠️ The Roster History tab couldn't be updated: ${written.error}`;
    }
    rosterWizards.delete(wizardKey(ticketId, interaction.user.id));
    // Discord roles only follow a change that was written to the sheet.
    const roleChanges = [];
    const roleLines = !plan.sheetChange
      ? []
      : plan.captain
        ? await applyCaptainRoles({ guild: interaction.guild, plan, record: roleChanges }).catch((error) => [`⚠️ Roles not changed: ${error.message || error}`])
        : await applyRosterRoles({ guild: interaction.guild, team: fresh.team, player, removedSlot, record: roleChanges }).catch((error) => [`⚠️ Roles not changed: ${error.message || error}`]);
    // Removing the captain leaves the team without one on the sheet.
    if (removedSlot && rosterCaptainSlot(fresh.team)?.label === removedSlot.label) {
      roleLines.push(`⚠️ ${removedSlot.alias} was the captain. Use **Change captain** to pick a new one.`);
    }
    const teamUrl = faceitTeamPageUrl(fresh.team.faceitUrl || ticket.teamFaceitUrl);
    const post = buildRosterChangePost({ teamName: fresh.team.teamName, group: ticket.group, requesterId: interaction.user.id, plan, player, ticketChannelId: ticket.channelId, roles: roleLines, teamUrl });
    const embed = () => new EmbedBuilder().setTitle(post.title).setDescription(post.description).addFields(post.fields).setColor(plan.sheetChange ? 0x5865f2 : 0xf1c40f);
    const ticketChannel = await client.channels.fetch(ticket.channelId).catch(() => null);
    await ticketChannel?.send?.({ embeds: [embed()] }).catch(() => null);
    const adminChannel = config.rosterChangeChannelId ? await client.channels.fetch(config.rosterChangeChannelId).catch(() => null) : null;
    // A claimed ticket pings only the admin handling it; otherwise the roster change roles.
    const handler = (await getTicket(ticketId).catch(() => null))?.claimedBy || ticket.claimedBy || null;
    const pings = handler ? `<@${handler}>` : config.rosterChangePingRoleIds.map((roleId) => `<@&${roleId}>`).join(' ');
    const snapshot = plan.sheetChange ? written?.snapshot || null : null;
    const record = await createRosterChange({
      ticketId,
      ticketChannelId: ticket.channelId,
      requesterId: interaction.user.id,
      teamName: fresh.team.teamName,
      headerRow: fresh.team.headerRow,
      teamFaceitUrl: fresh.team.faceitUrl || ticket.teamFaceitUrl || null,
      teamUrl,
      kind: wizard.change.kind,
      summary: plan.summary,
      history: plan.history || [],
      sheetChange: plan.sheetChange,
      snapshot,
      roleChanges,
      faceit: rosterFaceitExpectations({ kind: wizard.change.kind, player, removedSlot, captainSlot: plan.captain?.slot || null, snapshot }),
      adminChannelId: adminChannel?.id || null
    }).catch((error) => {
      console.error(`[Roster] change record not saved: ${error.message || error}`);
      return null;
    });
    const adminPost = adminChannel?.isTextBased?.()
      ? await adminChannel.send({
        content: pings || undefined,
        embeds: [embed()],
        components: [rosterAdminButtons(record, { teamUrl })],
        allowedMentions: handler ? { parse: [], users: [handler] } : { parse: [], roles: config.rosterChangePingRoleIds }
      }).catch(() => null)
      : null;
    if (record && adminPost) await saveRosterChange(record.id, { adminMessageId: adminPost.id }).catch(() => null);
    // The roster list in the ticket shows the new roster.
    await refreshRosterPanel(ticket, ticketChannel);
    await appendAuditLog({ type: 'roster_change', ticketId, actorId: interaction.user.id, team: fresh.team.teamName, kind: wizard.change.kind, summary: plan.summary, sheetChange: plan.sheetChange, posted: Boolean(adminPost) }).catch(() => null);
    await interaction.editReply({
      content: [
        plan.sheetChange ? '✅ The roster sheet is updated.' : '⚠️ The sheet was left for an admin to sort out.',
        plan.summary,
        adminPost ? `Admins were told in <#${config.rosterChangeChannelId}> to update FACEIT.` : '⚠️ The admin post failed, so tell the staff in this ticket.',
        ...roleLines,
        historyWarning
      ].filter(Boolean).join('\n')
    });
  }
}

// Claim / Reassign / Priority / Close on a ticket header (staff only).
async function handleTicketControl(interaction) {
  const [kind, ticketId] = interaction.customId.split(':');
  const ticket = await getTicket(ticketId);
  if (!ticket || ticket.status !== 'open') {
    await interaction.reply({ content: 'This ticket is already closed.', ephemeral: true });
    return;
  }
  if (!canHandleTicket(interaction.member, ticket)) {
    await interaction.reply({ content: 'Only staff can do that.', ephemeral: true });
    return;
  }
  if (kind === 'ticket_claim') {
    if (ticket.claimedBy === interaction.user.id) {
      await interaction.reply({ content: "You're already handling this ticket.", ephemeral: true });
      return;
    }
    const saved = await saveTicket(ticketId, { claimedBy: interaction.user.id, claimedTag: interaction.user.username, claimedAt: new Date().toISOString() });
    // Claimed from the ticket's header or from the Tournament Operations alert: update that one in
    // place, and the other one too.
    if (interaction.message?.id === ticket.alertMessageId) {
      await interaction.update(ticketAlertPayload(saved));
      await refreshTicketHeader(saved);
    } else {
      await interaction.update(ticketHeaderPayload(saved));
      await refreshTicketAlert(saved);
    }
    await appendAuditLog({ type: 'ticket_claimed', ticketId, actorId: interaction.user.id, takeOver: Boolean(ticket.claimedBy) }).catch(() => null);
    return;
  }
  if (kind === 'ticket_reassign') {
    await interaction.reply({
      content: 'Who should handle this ticket?',
      components: [new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`ticket_assign:${ticketId}`).setMinValues(1).setMaxValues(1))],
      ephemeral: true
    });
    return;
  }
  if (kind === 'ticket_assign') {
    const userId = interaction.values?.[0];
    const user = userId ? await client.users.fetch(userId).catch(() => null) : null;
    const saved = await saveTicket(ticketId, { claimedBy: userId, claimedTag: user?.username || userId, claimedAt: new Date().toISOString() });
    await interaction.update({ content: `Reassigned to <@${userId}>.`, components: [] });
    await refreshTicketHeader(saved);
    await refreshTicketAlert(saved);
    await appendAuditLog({ type: 'ticket_reassigned', ticketId, actorId: interaction.user.id, to: userId }).catch(() => null);
    return;
  }
  if (kind === 'ticket_priority') {
    const value = interaction.values?.[0];
    if (!PRIORITIES[value]) {
      await interaction.reply({ content: 'Pick a priority from the list.', ephemeral: true });
      return;
    }
    const saved = await saveTicket(ticketId, { priority: value, priorityOverride: true, priorityReason: `Set by ${interaction.user.username}` });
    await interaction.update(ticketHeaderPayload(saved));
    await refreshTicketAlert(saved);
    await appendAuditLog({ type: 'ticket_priority', ticketId, actorId: interaction.user.id, priority: value }).catch(() => null);
    return;
  }
  if (kind === 'ticket_close') {
    const reason = new TextInputBuilder().setCustomId('reason').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500).setPlaceholder('Optional: how it was solved');
    await interaction.showModal(new ModalBuilder().setCustomId(`ticket_close_submit:${ticketId}`).setTitle(`Close ticket ${ticketNumberText(ticket.number)}`)
      .addLabelComponents(new LabelBuilder().setLabel('Reason (goes in the transcript)').setTextInputComponent(reason)));
  }
}

// Every message in the channel, oldest first, for the transcript.
async function ticketMessages(channel) {
  const all = [];
  let before;
  for (let page = 0; page < 30; page++) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!batch?.size) break;
    all.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  return all.map((message) => ({
    createdAt: message.createdTimestamp,
    author: message.author?.username || 'unknown',
    content: message.content || '',
    attachments: [...message.attachments.values()].map((file) => file.url),
    embeds: message.embeds.map((embed) => [embed.title, embed.description].filter(Boolean).join(' — ').slice(0, 500))
  }));
}

async function handleTicketClose(interaction) {
  const ticketId = interaction.customId.slice('ticket_close_submit:'.length);
  const ticket = await getTicket(ticketId);
  if (!ticket || ticket.status !== 'open') {
    await interaction.reply({ content: 'This ticket is already closed.', ephemeral: true });
    return;
  }
  if (!canHandleTicket(interaction.member, ticket)) {
    await interaction.reply({ content: 'Only staff can close tickets.', ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const reason = interaction.fields.getTextInputValue('reason')?.trim() || null;
  const channel = interaction.channel;
  const now = Date.now();
  const transcript = buildTranscript(ticket, await ticketMessages(channel), { closedBy: interaction.user.username, reason, nowMs: now });
  const receipts = config.ticketReceiptsChannelId ? await client.channels.fetch(config.ticketReceiptsChannelId).catch(() => null) : null;
  const closed = { ...ticket, status: 'closed', closedBy: interaction.user.id, closedAt: new Date(now).toISOString(), closeReason: reason };
  const header = buildTicketHeader(closed);
  const sent = receipts?.isTextBased?.()
    ? await receipts.send({
      embeds: [new EmbedBuilder().setTitle(header.title).setDescription(`Closed by <@${interaction.user.id}>.`).addFields(header.fields).setColor(0x95a5a6)],
      files: [{ attachment: Buffer.from(transcript, 'utf8'), name: `ticket-${ticket.id}.txt` }],
      allowedMentions: { parse: [] }
    }).catch((error) => {
      console.error(`[Tickets] transcript for ${ticket.id} not posted: ${error.message || error}`);
      return null;
    })
    : null;
  if (!sent) {
    await interaction.editReply("⚠️ The transcript couldn't be posted to Support Receipts, so the ticket was left open. Check the bot can post files there, then close again.");
    return;
  }
  const closedTicket = await saveTicket(ticketId, { status: 'closed', closedBy: interaction.user.id, closedAt: closed.closedAt, closeReason: reason, transcriptMessageId: sent.id });
  await refreshTicketAlert(closedTicket);
  await appendAuditLog({ type: 'ticket_closed', ticketId, actorId: interaction.user.id, reason }).catch(() => null);
  await interaction.editReply('Transcript saved to Support Receipts. Deleting this channel in 5 seconds.');
  await channel.send({ content: `🔒 Ticket closed by <@${interaction.user.id}>${reason ? `: ${reason}` : ''}. This channel will be deleted in 5 seconds.`, allowedMentions: { parse: [] } }).catch(() => null);
  setTimeout(() => {
    channel.delete(`Ticket ${ticketNumberText(ticket.number)} closed`).catch((error) => console.error(`[Tickets] could not delete ${channel.id}: ${error.message || error}`));
  }, 5000);
}

// Every 10 minutes: re-read each open roster ticket's next match (every 30 minutes per ticket) and
// bump it to priority when the match is now within 24 hours (unless staff set the priority).
let lastTicketPriorityCheckAt = 0;
async function syncTicketPriorities(now = Date.now()) {
  if (now - lastTicketPriorityCheckAt < 10 * 60 * 1000) return;
  lastTicketPriorityCheckAt = now;
  for (const ticket of await listTickets({ status: 'open' })) {
    if (ticket.topic !== 'roster' || ticket.priorityOverride) continue;
    let current = ticket;
    if (now - (Date.parse(ticket.nextMatchCheckedAt || '') || 0) >= 30 * 60 * 1000) {
      const next = await nextTeamMatch({ teamName: ticket.teamName, faceitUrl: ticket.teamFaceitUrl }, now);
      current = await saveTicket(ticket.id, {
        nextMatchCheckedAt: new Date(now).toISOString(),
        ...(next.ok ? { nextMatchIso: next.startMs ? new Date(next.startMs).toISOString() : null, needsVerify: false } : {})
      }) || ticket;
    }
    if (!shouldBumpRoster(current, now)) continue;
    const saved = await saveTicket(ticket.id, { priority: 'priority', priorityReason: 'Next match within 24 hours (bumped)' });
    const channel = await refreshTicketHeader(saved);
    await refreshTicketAlert(saved);
    const startSec = Math.floor(Date.parse(saved.nextMatchIso) / 1000);
    await channel?.send?.({ content: `⏫ Bumped to **${priorityText('priority')}**: ${saved.teamName}'s next match is <t:${startSec}:R>.`, allowedMentions: { parse: [] } }).catch(() => null);
    await appendAuditLog({ type: 'ticket_bumped', ticketId: ticket.id, nextMatchIso: saved.nextMatchIso }).catch(() => null);
  }
}

// "Done on FACEIT" on the admin post: staff only; marks who did it and when, then disables the button.
// The buttons under a roster change post: Done on FACEIT, Undo (when the bot can undo it) and the
// team's FACEIT page. Old posts (no record) only have "roster_done".
function rosterAdminButtons(record, { teamUrl = null, done = false, undone = false } = {}) {
  const id = record?.id ? `:${record.id}` : '';
  const buttons = [new ButtonBuilder().setCustomId(`roster_done${id}`).setLabel('Done on FACEIT').setStyle(ButtonStyle.Success).setDisabled(done || undone)];
  if (record?.snapshot) buttons.push(new ButtonBuilder().setCustomId(`roster_undo${id}`).setLabel(undone ? 'Undone' : 'Undo').setStyle(ButtonStyle.Danger).setDisabled(undone));
  const url = teamUrl || record?.teamUrl;
  if (url) buttons.push(new ButtonBuilder().setLabel('Open team on FACEIT').setStyle(ButtonStyle.Link).setURL(url));
  return new ActionRowBuilder().addComponents(buttons);
}

// The roster list in a roster ticket, refreshed from the sheet.
async function refreshRosterPanel(ticket, channel = null) {
  const ticketChannel = channel || await client.channels.fetch(ticket.channelId).catch(() => null);
  if (!ticketChannel?.messages) return;
  const reloaded = await freshRosterTeam(ticket);
  if (!reloaded.team) return;
  const panel = (await ticketChannel.messages.fetch({ limit: 30 }).catch(() => null))?.find((message) => message.author.id === client.user.id && message.embeds?.[0]?.title?.endsWith(' roster'));
  if (panel) await panel.edit(rosterPanelPayload(ticket, reloaded.team)).catch(() => null);
}

// Tells the captain in their ticket (or by DM when the ticket is gone).
async function tellRosterRequester(record, content) {
  const payload = { content: `<@${record.requesterId}> ${content}`, allowedMentions: { users: [record.requesterId] } };
  const channel = record.ticketChannelId ? await client.channels.fetch(record.ticketChannelId).catch(() => null) : null;
  if (channel?.isTextBased?.() && await channel.send(payload).then(() => true).catch(() => false)) return true;
  const user = await client.users.fetch(record.requesterId).catch(() => null);
  return Boolean(user && await user.send({ content }).then(() => true).catch(() => false));
}

async function rosterAdminMessage(record) {
  if (!record?.adminChannelId || !record.adminMessageId) return null;
  const channel = await client.channels.fetch(record.adminChannelId).catch(() => null);
  return channel?.messages ? channel.messages.fetch(record.adminMessageId).catch(() => null) : null;
}

// Stamps the admin post "Done on FACEIT" and tells the captain.
async function markRosterDone(record, actorId, note = null) {
  const now = Date.now();
  const saved = await saveRosterChange(record.id, { doneAt: new Date(now).toISOString(), doneBy: actorId, doneNote: note });
  const message = await rosterAdminMessage(record);
  if (message) {
    const original = message.embeds?.[0];
    const embed = original ? EmbedBuilder.from(original) : new EmbedBuilder().setTitle('Roster change');
    embed.addFields({ name: 'Done on FACEIT', value: [`<@${actorId}> · <t:${Math.floor(now / 1000)}:f>`, note].filter(Boolean).join('\n').slice(0, 1024) }).setColor(0x2ecc71);
    await message.edit({ embeds: [embed], components: [rosterAdminButtons(saved || record, { done: true })], allowedMentions: { parse: [] } }).catch(() => null);
  }
  const told = await tellRosterRequester(record, `✅ Your roster change for **${record.teamName}** is done on FACEIT: ${record.summary}`);
  await appendAuditLog({ type: 'roster_change_done', actorId, rosterChangeId: record.id, toldCaptain: told }).catch(() => null);
  return told;
}

// The FACEIT team compared with what the change should have done there.
async function faceitRosterProblems(record) {
  const teamId = faceitTeamIdFromUrl(record.teamFaceitUrl);
  if (!teamId || !faceit || !config.faceitApiKey) return { checked: false, problems: [], note: null };
  try {
    const result = checkFaceitRoster(record.faceit, await faceit.getTeam(teamId));
    return { ...result, note: result.checked && !result.problems.length ? '✅ FACEIT roster checked' : null };
  } catch (error) {
    return { checked: false, problems: [], note: `⚠️ Couldn't check FACEIT (${String(error.message || error).slice(0, 80)})` };
  }
}

async function handleRosterDone(interaction) {
  if (!isTicketStaff(interaction.member)) {
    await interaction.reply({ content: 'Only admins can do that.', ephemeral: true });
    return;
  }
  const [kind, recordId] = interaction.customId.split(':');

  // Posts from before change records: stamp the post, nothing else.
  if (kind === 'roster_done' && !recordId) {
    const original = interaction.message.embeds?.[0];
    const embed = original ? EmbedBuilder.from(original) : new EmbedBuilder().setTitle('Roster change');
    embed.addFields({ name: 'Done on FACEIT', value: `<@${interaction.user.id}> · <t:${Math.floor(Date.now() / 1000)}:f>` }).setColor(0x2ecc71);
    await interaction.update({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('roster_done').setLabel('Done on FACEIT').setStyle(ButtonStyle.Success).setDisabled(true),
        ...(interaction.message.components?.[0]?.components || []).filter((button) => button.url).map((button) => new ButtonBuilder().setLabel(button.label || 'Open team on FACEIT').setStyle(ButtonStyle.Link).setURL(button.url))
      )],
      allowedMentions: { parse: [] }
    });
    await appendAuditLog({ type: 'roster_change_done', actorId: interaction.user.id, messageId: interaction.message.id }).catch(() => null);
    return;
  }

  const record = recordId ? await getRosterChange(recordId) : null;
  if (!record) {
    await interaction.reply({ content: "That roster change isn't in the bot's records any more.", ephemeral: true });
    return;
  }
  if (record.undoneAt) {
    await interaction.reply({ content: `This change was undone by <@${record.undoneBy}>.`, ephemeral: true, allowedMentions: { parse: [] } });
    return;
  }

  if (kind === 'roster_done' || kind === 'roster_doneforce') {
    if (record.doneAt) {
      await interaction.reply({ content: `Already marked done by <@${record.doneBy}>.`, ephemeral: true, allowedMentions: { parse: [] } });
      return;
    }
    if (kind === 'roster_doneforce') {
      await interaction.update({ content: 'Marking it done…', components: [] });
      const told = await markRosterDone(record, interaction.user.id, '⚠️ Marked done while FACEIT still differed');
      await interaction.editReply({ content: `Marked done.${told ? ' The captain was told.' : " Couldn't reach the captain."}` });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const check = await faceitRosterProblems(record);
    if (check.problems.length) {
      await interaction.editReply({
        content: ['FACEIT doesn\'t match this change yet:', ...check.problems.map((problem) => `• ${problem}`), '', 'Fix it on FACEIT and press **Done on FACEIT** again, or mark it done anyway.'].join('\n'),
        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`roster_doneforce:${record.id}`).setLabel('Mark done anyway').setStyle(ButtonStyle.Secondary))]
      });
      return;
    }
    const told = await markRosterDone(record, interaction.user.id, check.note);
    await interaction.editReply({ content: [`Marked done.${told ? ' The captain was told.' : " Couldn't reach the captain."}`, check.note].filter(Boolean).join('\n') });
    return;
  }

  if (kind === 'roster_undo') {
    const undo = rosterUndoPlan(record);
    if (!undo.ok) {
      await interaction.reply({ content: undo.error, ephemeral: true });
      return;
    }
    await interaction.reply({
      content: [
        `Undo this change for **${record.teamName}**?`,
        record.summary,
        '',
        'The roster sheet goes back to how it was, the Discord roles the change gave or took are reversed, and the captain is told.',
        record.doneAt ? '⚠️ It was already marked done, so change FACEIT back too.' : null
      ].filter((line) => line !== null).join('\n'),
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`roster_undoyes:${record.id}`).setLabel('Yes, undo it').setStyle(ButtonStyle.Danger))],
      ephemeral: true
    });
    return;
  }

  if (kind === 'roster_undoyes') {
    await interaction.update({ content: 'Undoing…', components: [] });
    const undo = rosterUndoPlan(record);
    if (!undo.ok) {
      await interaction.editReply({ content: undo.error });
      return;
    }
    const written = await scheduleSheet.applyRosterOps({
      spreadsheetId: config.rosterSpreadsheetId,
      sheetName: config.rosterSheetName,
      teamName: record.teamName,
      headerRow: record.headerRow,
      expect: undo.expect,
      expectCaptain: undo.expectCaptain,
      ops: undo.ops,
      linkLabel: config.rosterLinkLabel,
      logLine: undo.logLine,
      history: undo.history,
      historySheetName: config.rosterHistorySheetName,
      requestedBy: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
      when: new Date().toISOString(),
      whenText: historyWhenText(new Date(), config.defaultTimezone)
    });
    if (!written.ok) {
      await interaction.editReply({ content: `❌ Couldn't undo it on the sheet: ${written.error}\nIf a later change touched the same players, undo that one first, or fix the sheet by hand.` });
      return;
    }
    // Discord roles back the other way, newest first.
    const roleLines = [];
    const guild = interaction.guild;
    for (const change of [...(record.roleChanges || [])].reverse()) {
      const member = guild ? await guild.members.fetch(change.userId).catch(() => null) : null;
      if (!member) {
        roleLines.push(`⚠️ <@${change.userId}> isn't in the server, so their roles weren't changed back.`);
        continue;
      }
      const ok = change.action === 'add'
        ? await member.roles.remove(change.roleIds, 'Roster change undone').then(() => true).catch(() => false)
        : await member.roles.add(change.roleIds, 'Roster change undone').then(() => true).catch(() => false);
      const roles = change.roleIds.map((roleId) => `<@&${roleId}>`).join(' ');
      roleLines.push(ok ? `🎭 ${change.action === 'add' ? 'Removed' : 'Gave back'} ${roles} ${change.action === 'add' ? 'from' : 'to'} <@${member.id}>.` : `⚠️ Couldn't change <@${member.id}>'s roles back (${roles}).`);
    }
    const now = Date.now();
    const saved = await saveRosterChange(record.id, { undoneAt: new Date(now).toISOString(), undoneBy: interaction.user.id });
    const message = await rosterAdminMessage(record);
    if (message) {
      const original = message.embeds?.[0];
      const embed = original ? EmbedBuilder.from(original) : new EmbedBuilder().setTitle('Roster change');
      embed.addFields({ name: 'Undone', value: [`<@${interaction.user.id}> · <t:${Math.floor(now / 1000)}:f>`, ...roleLines].join('\n').slice(0, 1024) }).setColor(0x95a5a6);
      await message.edit({ embeds: [embed], components: [rosterAdminButtons(saved || record, { undone: true })], allowedMentions: { parse: [] } }).catch(() => null);
    }
    const ticket = await getTicket(record.ticketId).catch(() => null);
    if (ticket?.status === 'open') await refreshRosterPanel(ticket);
    const told = await tellRosterRequester(record, `↩️ An admin undid your roster change for **${record.teamName}**: ${record.summary}`);
    await appendAuditLog({ type: 'roster_change_undone', actorId: interaction.user.id, rosterChangeId: record.id, toldCaptain: told }).catch(() => null);
    await interaction.editReply({
      content: ['↩️ Undone. The roster sheet is back to how it was.', ...roleLines, told ? 'The captain was told.' : "⚠️ Couldn't reach the captain.", record.doneAt ? '⚠️ It was already done on FACEIT, so change FACEIT back too.' : null].filter(Boolean).join('\n'),
      allowedMentions: { parse: [] }
    });
  }
}

// Every 10 minutes: roster changes not marked "Done on FACEIT" get a reminder (a reply to the admin
// post, pinging the admin handling the ticket, else the roster change roles).
let lastRosterReminderCheckAt = 0;
async function remindRosterChanges(now = Date.now()) {
  if (now - lastRosterReminderCheckAt < 10 * 60 * 1000) return;
  lastRosterReminderCheckAt = now;
  for (const record of await listOpenRosterChanges()) {
    const ticket = record.ticketId ? await getTicket(record.ticketId).catch(() => null) : null;
    const nextMatchMs = Date.parse(ticket?.nextMatchIso || '') || null;
    const due = rosterReminderDue(record, {
      now,
      nextMatchMs,
      everyHours: config.rosterDoneReminderHours,
      maxReminders: config.rosterDoneReminderMax,
      soonMinutes: config.rosterDoneSoonMinutes
    });
    if (!due) continue;
    const message = await rosterAdminMessage(record);
    if (!message) {
      // The post was deleted (or Discord is down): give up after a few tries.
      const misses = Number(record.adminMessageMisses || 0) + 1;
      await saveRosterChange(record.id, misses >= 3 ? { adminMessageMisses: misses, adminMessageId: null } : { adminMessageMisses: misses }).catch(() => null);
      continue;
    }
    const handler = ticket?.claimedBy || null;
    const ping = handler ? `<@${handler}>` : config.rosterChangePingRoleIds.map((roleId) => `<@&${roleId}>`).join(' ');
    const asked = Date.parse(record.createdAt || '') || now;
    const text = due === 'soon'
      ? `⏰ ${ping} **${record.teamName}** plays <t:${Math.floor(nextMatchMs / 1000)}:R> and this roster change isn't done on FACEIT yet.`
      : `⏰ ${ping} This roster change for **${record.teamName}** (asked <t:${Math.floor(asked / 1000)}:R>) isn't done on FACEIT yet.`;
    const sent = await message.reply({
      content: text,
      allowedMentions: handler ? { parse: [], users: [handler], repliedUser: false } : { parse: [], roles: config.rosterChangePingRoleIds, repliedUser: false }
    }).then(() => true).catch(() => false);
    if (!sent) continue;
    await saveRosterChange(record.id, due === 'soon'
      ? { soonRemindedAt: new Date(now).toISOString() }
      : { lastRemindedAt: new Date(now).toISOString(), reminderCount: Number(record.reminderCount || 0) + 1 }).catch(() => null);
  }
}

// --- Streaming applications -------------------------------------------------------------------
// Every 5 minutes: new rows on the Streaming Application form's response tab are posted in
// CASTER_APPLICATION_CHANNEL_ID pinging CASTER_APPLICATION_PING_IDS. The last row seen is kept in
// sheet sync; the first run only records where the tab ends, so old applications aren't posted.
const CASTER_APPLICATION_CHECK_MS = 5 * 60 * 1000;
let lastCasterApplicationCheckAt = 0;

async function postNewCasterApplications(now = Date.now()) {
  if (!config.casterApplicationChannelId || scheduleSheet.mode !== 'apps-script') return;
  if (now - lastCasterApplicationCheckAt < CASTER_APPLICATION_CHECK_MS) return;
  lastCasterApplicationCheckAt = now;
  const key = 'casterApplications';
  const state = (await getSheetSync())[key] || {};
  const lastSeen = Number.isInteger(state.lastRow) ? state.lastRow : null;
  const result = await scheduleSheet.readCasterApplications(lastSeen);
  if (!result.ok) {
    if (state.error !== result.error) console.error(`[Applications] could not read the application sheet: ${result.error}`);
    await updateSheetSync(key, { error: result.error, errorAt: new Date(now).toISOString() });
    return;
  }
  if (lastSeen === null) {
    await updateSheetSync(key, { lastRow: result.lastRow ?? 1, startedAt: new Date(now).toISOString(), error: null });
    console.log(`[Applications] watching the application sheet from row ${result.lastRow ?? 1}.`);
    return;
  }
  const channel = await client.channels.fetch(config.casterApplicationChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) {
    console.warn('[Applications] CASTER_APPLICATION_CHANNEL_ID is not a channel the bot can post in.');
    return;
  }
  let seen = lastSeen;
  for (const entry of result.rows) {
    if (!entry.values?.some((value) => String(value || '').trim())) {
      seen = entry.row;
      continue;
    }
    const app = parseApplication(result.headers, entry.values);
    const memberId = app.discord ? await findMemberIdByName(channel.guild, app.discord).catch(() => null) : null;
    let history = null;
    if (memberId) {
      const requests = await listStreamRequests({ requesterId: memberId });
      const forms = selectFormCasts(requests, { since: config.postCastFormGateSince });
      history = {
        approved: requests.filter((request) => request.status === 'approved').length,
        formsIn: forms.submitted.length,
        formsTotal: forms.missing.length + forms.submitted.length
      };
    }
    const card = buildApplicationCard(app, { memberId, history, sheetUrl: config.casterApplicationSheetUrl, rowNumber: entry.row });
    const pings = config.casterApplicationPingIds.map((id) => `<@${id}>`).join(' ');
    const sent = await channel.send({
      content: pings || undefined,
      embeds: [new EmbedBuilder().setTitle(card.title).setDescription(card.description).setColor(0x9146ff)],
      allowedMentions: { parse: [], users: config.casterApplicationPingIds }
    }).catch((error) => {
      console.error(`[Applications] could not post row ${entry.row}: ${error.message || error}`);
      return null;
    });
    if (!sent) break;
    seen = entry.row;
    await appendAuditLog({ type: 'caster_application_posted', row: entry.row, applicant: app.discord || null, memberId }).catch(() => null);
  }
  if (seen !== lastSeen) await updateSheetSync(key, { lastRow: seen, error: null, postedAt: new Date(now).toISOString() });
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
  // normalizeScheduleText also fixes "8:30est", "p.m." and misspelled months/days.
  const cleaned = normalizeScheduleText(original
    .replace(/<@!?\d+>/g, ' ')
    .replace(/\bgame\s*time\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim());
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
  await runPrepPacks(now).catch((error) => console.error('Prep packs failed:', error));
  await syncTeamInfo(now).catch((error) => console.error('Team Info sync failed:', error));
  await runSocialInfo(now).catch((error) => console.error('Social info failed:', error.message || error));
  await fillSeasonMatchStats().catch((error) => console.error('Season match stats fill failed:', error.message || error));
  await syncSheetResultsAndStats(now).catch((error) => console.error('Sheet results/stats sync failed:', error));
  await postNewCasterApplications(now).catch((error) => console.error('Caster applications failed:', error));
  await syncTicketPriorities(now).catch((error) => console.error('Ticket priorities failed:', error));
  await remindRosterChanges(now).catch((error) => console.error('Roster change reminders failed:', error));
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

// Options for each crew form dropdown: everyone on the staff schedule who can do the role, free
// first, then partly free / maybe, then the rest marked "Not free" (busy, on another crew, or not
// filled in), plus the current picks. null = availability is not available (plain user pickers).
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
      if (seen.has(id)) continue;
      seen.add(id);
      const notFree = !['free', 'partial', 'maybe'].includes(entry.state);
      options.push({
        label: `${entry.person.name} (${entry.worked} this week)`.slice(0, 100),
        description: notFree ? `⚠️ Not free · ${crewEntryDescription(entry)}`.slice(0, 100) : crewEntryDescription(entry),
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
  const whenText = (interaction.options.getString('when') || 'today').trim();
  const durationMinutes = interaction.options.getInteger('length') || config.crewMatchLengthMinutes;
  const stored = await syncCrewAvailability(Date.now()) || await getCrewAvailability();
  if (!stored?.data) {
    await interaction.editReply(`I haven't been able to read the staff schedule yet${stored?.error ? `: ${stored.error}` : ''}. The sheet web app needs the "availability" action (redeploy the Apps Script).`);
    return;
  }
  const link = parseFaceitMatchRoomLink(whenText);
  const matchId = link?.matchId || null;
  const cleanedWhen = normalizeScheduleText(whenText);
  const startMs = matchId ? await matchStartMs(matchId) : parseCrewWhen(cleanedWhen);
  if (!matchId && !Number.isFinite(startMs)) {
    // No time given: show the whole day.
    const dateKey = parseDayKey(cleanedWhen, easternParts(Date.now()).dateKey);
    if (dateKey) {
      await interaction.editReply({ embeds: [await crewDayEmbed(stored, dateKey)] });
      return;
    }
  }
  if (!Number.isFinite(startMs)) {
    await interaction.editReply(matchId
      ? 'That match has no time yet.'
      : `Couldn't read "${whenText}". Try \`today\`, \`Thurs\`, \`11/12\`, \`Thurs 9:30pm\`, \`11/12 9pm\` or a FACEIT matchroom link.`);
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

function crewSyncFooter(stored) {
  const syncedMs = Date.parse(stored?.syncedAt || '');
  const time = Number.isFinite(syncedMs)
    ? `${new Date(syncedMs).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} ET`
    : 'just now';
  return `Staff schedule read ${time}${stored?.error ? ' (latest read failed)' : ''}`;
}

// `/cf whosfree` for a whole day: everyone's availability that day by role, plus who is already on a
// main stream crew that day.
async function crewDayEmbed(stored, dateKey) {
  const now = Date.now();
  const people = crewPeopleWithIds(stored);
  const allBookings = await crewBookings();
  const bookings = allBookings.filter((booking) => sheetSlotFor(booking.startMs).dateKey === dateKey);
  const bookedNote = (person) => {
    if (!person.userId) return '';
    const times = bookings
      .filter((booking) => booking.userIds.includes(person.userId))
      .map((booking) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(booking.startMs)));
    return times.length ? `, booked ${times.join(' & ')}` : '';
  };
  const order = { free: 0, partial: 1, maybe: 2, unknown: 3, busy: 4 };
  const fields = [];
  for (const role of CREW_ROLES) {
    const entries = people
      .filter((person) => person.roles?.includes(role))
      .map((person) => ({ person, ...dayAvailability(person, dateKey), worked: person.userId ? workedThisWeek(allBookings, person.userId, now) : 0 }));
    if (!entries.length) continue;
    entries.sort((a, b) => order[a.state] - order[b.state] || a.worked - b.worked || a.person.name.localeCompare(b.person.name));
    const list = (state, format) => entries.filter((entry) => entry.state === state).map(format);
    const free = list('free', (entry) => `${entry.person.name} (${entry.worked}${bookedNote(entry.person)})`);
    const partial = list('partial', (entry) => `${entry.person.name} (${entry.note}${bookedNote(entry.person)})`);
    const maybe = list('maybe', (entry) => `${entry.person.name}${entry.note && entry.note !== 'could work' ? ` (${entry.note})` : ''}`);
    const missing = list('unknown', (entry) => entry.person.name);
    const value = [
      free.length ? `✅ All day: ${free.join(', ')}` : '✅ Nobody free all day',
      partial.length ? `🕒 Part of the day: ${partial.join(', ')}` : null,
      maybe.length ? `❔ Maybe: ${maybe.join(', ')}` : null,
      missing.length ? `▫️ Not filled in: ${missing.join(', ')}` : null
    ].filter(Boolean).join('\n');
    fields.push({ name: CREW_ROLE_LABELS[role], value: value.slice(0, 1024) });
  }
  const dayLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(`${dateKey}T12:00:00Z`));
  const onStream = bookings.length
    ? `Main stream that day: ${bookings.map((booking) => `${booking.coverage.matchup} (${discordTimestamp(new Date(booking.startMs).toISOString(), 't')})`).join(', ')}.`
    : 'No main stream matches booked that day yet.';
  return new EmbedBuilder()
    .setTitle(`Who's free · ${dayLabel}`)
    .setDescription(`The whole day, from the staff schedule. Numbers are main stream matches worked this week. Add a time (e.g. \`${dayLabel.split(',')[0]} 9:30pm\`) to check one match.\n${onStream}`)
    .addFields(fields.length ? fields : [{ name: 'Nobody', value: 'Nobody is on the staff schedule for that day.' }])
    .setColor(0x4a86e8)
    .setFooter({ text: crewSyncFooter(stored) });
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
  const input = content.replace(/^!add\s*game\b/i, '').trim();
  const link = input.split(/\s+/)[0] || '';
  const timeText = input.slice(link.length).trim();
  const parsed = parseFaceitMatchRoomLink(link);
  if (!parsed) {
    await message.reply('Use `!addgame FACEIT_MATCHROOM_LINK`, or with a time: `!addgame FACEIT_MATCHROOM_LINK 11/9 8:30 PM ET`.');
    return;
  }
  // An optional time after the link wins over everything else.
  const typedTime = timeText ? parseScheduleInput(timeText) : null;
  if (timeText && !typedTime) {
    await message.reply(`I couldn't read **${timeText.slice(0, 80)}** as a date and time. Try \`!addgame ${link} 11/9 8:30 PM ET\`.`);
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

  // Time: one typed after the link, else the admin-approved schedule, else FACEIT's scheduled time.
  const schedule = await getSchedule(parsed.matchId).catch(() => null);
  let proposal = schedule?.adminApproved ? { ...schedule, matchId: parsed.matchId } : null;
  let timeSource = 'the approved time';
  if (typedTime) {
    proposal = { ...(proposal || {}), scheduledAtIso: typedTime.iso, scheduledAt: typedTime.display, timezone: typedTime.timeZone, matchId: parsed.matchId };
    timeSource = 'the time you gave';
  } else if (!proposal?.scheduledAtIso) {
    const faceitMatch = await faceit.getMatch(parsed.matchId).catch(() => null);
    const faceitIso = getFaceitScheduledAtIso(faceitMatch) || getFaceitScheduledAtIso(stored.match);
    proposal = faceitIso ? { scheduledAtIso: faceitIso, scheduledAt: faceitIso, matchId: parsed.matchId } : proposal;
    timeSource = faceitIso ? "FACEIT's time (no time approved in Discord)" : null;
  }

  // Confirm the match in the bot too, so it shows in /request open, the daily Upcoming Matches
  // post, crew planning and the IP prompts, not only on the sheet.
  let confirmedInBot = false;
  if (proposal?.scheduledAtIso && (typedTime || !(schedule?.adminApproved && Date.parse(schedule.scheduledAtIso || '')))) {
    await saveSchedule(parsed.matchId, {
      scheduledAt: proposal.scheduledAt && !/^\d{4}-\d{2}-\d{2}T/.test(proposal.scheduledAt) ? proposal.scheduledAt : formatScheduleDisplay(new Date(proposal.scheduledAtIso), 'America/New_York'),
      scheduledAtIso: proposal.scheduledAtIso,
      timezone: proposal.timezone || 'America/New_York',
      adminApproved: true,
      approvedBy: message.author.id,
      scheduledAtIsoSource: typedTime ? 'addgame' : (schedule?.adminApproved ? 'faceit-fix' : 'faceit'),
      kind: 'manual'
    });
    confirmedInBot = true;
  }

  const warning = await logScheduleToSheet({ stored, proposal, approvedBy: message.author.id, kind: 'manual' });
  const matchup = `${stored.match.teamA || 'TBD'} vs ${stored.match.teamB || 'TBD'}`;
  if (warning) {
    await message.reply({ content: `⚠️ ${matchup}: ${warning}`, allowedMentions: { parse: [] } });
    return;
  }
  const lines = [
    `📄 **${matchup}** is on the Google Sheet${proposal?.scheduledAtIso ? ` for ${discordTimestamp(new Date(proposal.scheduledAtIso).toISOString(), 'F')}, using ${timeSource}` : ' with no time yet (nothing approved and nothing on FACEIT). Add the time after the link to confirm it: `!addgame <link> 11/9 8:30 PM ET`'}.`,
    confirmedInBot ? '✅ Confirmed in the bot too: it now shows in `/request open` and the Upcoming Matches post.' : null
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
  await message.reply({ content: lines.filter(Boolean).join('\n').slice(0, 2000), allowedMentions: { parse: [] } });
}


// --- Season crew stats ------------------------------------------------------------------
// `/cf crewstats`: community casts per caster and main stream matches per person and role.
// `/cf crewimport`: reads this season's Schedule channel posts so crews set up by hand before the
// bot kept them count too (preview first, nothing saved until staff press Import).

const pendingCrewImports = new Map();
const CREW_IMPORT_TTL_MS = 15 * 60 * 1000;
const CREW_IMPORT_MAX_MESSAGES = 5000;

function seasonInRange(season) {
  return (ms) => seasonContains(season, easternParts(ms).dateKey);
}

async function seasonCrewSources() {
  const mainStream = new Map();
  for (const record of await listCrewHistory()) {
    const startMs = Date.parse(record.startIso || '');
    if (Number.isFinite(startMs)) mainStream.set(record.matchId, { matchId: record.matchId, startMs, crew: record.crew || {}, matchup: record.matchup });
  }
  for (const booking of await crewBookings()) {
    mainStream.set(booking.matchId, { matchId: booking.matchId, startMs: booking.startMs, crew: booking.coverage.crew || {}, matchup: booking.coverage.matchup });
  }
  const community = (await listStreamRequests({ status: 'approved' }))
    .filter((request) => !/cancel/i.test(String(request.faceitStatus || '')))
    .map((request) => ({ requesterId: request.requesterId, startMs: Date.parse(castTimeIso(request) || ''), matchup: request.matchup }));
  return { mainStream: [...mainStream.values()], community };
}

async function handleCrewStatsCommand(interaction) {
  await interaction.deferReply({ ephemeral: true });
  await refreshSeasonCache();
  const ref = interaction.options.getString('season');
  const season = ref ? findSeasonByRef(seasonCache, ref) : statsSeason();
  if (!season) {
    await interaction.editReply(ref ? `No season called "${ref}".` : 'There is no current season. Pick one with `season:`.');
    return;
  }
  const sources = await seasonCrewSources();
  const inSeason = seasonInRange(season);
  const user = interaction.options.getUser('user');
  const importNote = (await listCrewHistory()).length ? '' : ' Main stream crews set up by hand (before the bot kept them) are missing until `/cf crewimport` is run.';
  if (user) {
    const history = personSeasonHistory(user.id, { ...sources, inSeason });
    const now = Date.now();
    const done = history.filter((entry) => entry.startMs <= now);
    const byRole = {};
    for (const entry of done) for (const role of entry.roles) byRole[role] = (byRole[role] || 0) + 1;
    const booked = history.length - done.length;
    const lines = history.slice(0, 20).map((entry) => `${discordTimestamp(new Date(entry.startMs).toISOString(), 'd')} · ${entry.matchup || 'Match'} · ${entry.roles.join(' & ')}${entry.startMs > now ? ' (booked)' : ''}`);
    const embed = new EmbedBuilder()
      .setTitle(`${season.name} · ${user.globalName || user.username}`)
      .setDescription([
        `<@${user.id}>`,
        Object.keys(byRole).length ? Object.entries(byRole).map(([role, count]) => `**${role}** ${count}`).join(' · ') : 'Nothing worked yet this season.',
        booked ? `${booked} more booked.` : null,
        '',
        ...(lines.length ? lines : ['No matches.']),
        history.length > 20 ? `… and ${history.length - 20} more.` : null
      ].filter((line) => line !== null).join('\n').slice(0, 4000))
      .setColor(0x4a86e8)
      .setFooter({ text: `Counts matches already played; booked ones are listed separately.${importNote}`.slice(0, 2048) });
    await interaction.editReply({ embeds: [embed] });
    return;
  }
  const stats = computeSeasonCrewStats({ ...sources, inSeason });
  const embed = new EmbedBuilder()
    .setTitle(`${season.name} · Crew stats`)
    .setDescription(`${stats.mainStreamMatches} main stream match(es) and ${stats.communityCasts} community cast(s) this season. Numbers are matches already played; (+N) are booked.`)
    .addFields(
      ...STAT_ROLES.map((role) => ({ name: `Main stream · ${STAT_ROLE_LABELS[role]}`, value: formatRanking(stats.roles[role]) })),
      { name: 'Community casts', value: formatRanking(stats.community) }
    )
    .setColor(0x4a86e8)
    .setFooter({ text: `Use user: for one person's full season.${importNote}`.slice(0, 2048) });
  await interaction.editReply({ embeds: [embed] });
}

// Plain-text names in a post: a linked staff schedule name, else a Discord member with that name.
async function resolveCrewNames(names, guild, people) {
  const resolved = {};
  const unknown = [];
  for (const [role, list] of Object.entries(names || {})) {
    for (const name of list) {
      const person = people.find((entry) => entry.key === normalizeCrewName(name) && entry.userId);
      const id = person?.userId || await findMemberIdByName(guild, name);
      if (id) resolved[role] = [...(resolved[role] || []), id];
      else unknown.push(name);
    }
  }
  return { resolved, unknown };
}

async function handleCrewImportCommand(interaction) {
  await interaction.deferReply({ ephemeral: true });
  await refreshSeasonCache();
  const season = statsSeason();
  if (!season) {
    await interaction.editReply('There is no current season to import into.');
    return;
  }
  const channel = config.productionScheduleChannelId ? await client.channels.fetch(config.productionScheduleChannelId).catch(() => null) : null;
  if (!channel?.isTextBased?.()) {
    await interaction.editReply('I can\'t read the Schedule channel (`PRODUCTION_SCHEDULE_CHANNEL_ID`).');
    return;
  }
  // Posts go up a few days before the match, so read from a week before the season starts.
  const sinceMs = Date.parse(`${season.startDate}T00:00:00Z`) - 7 * 24 * 60 * 60 * 1000;
  const messages = [];
  let before;
  while (messages.length < CREW_IMPORT_MAX_MESSAGES) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!batch?.size) break;
    messages.push(...batch.values());
    const oldest = batch.last();
    before = oldest.id;
    if (oldest.createdTimestamp < sinceMs) break;
  }
  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const guild = channel.guild;
  const people = crewPeopleWithIds(await getCrewAvailability());
  const inSeason = seasonInRange(season);
  const records = new Map();
  const unreadable = [];
  const unknownNames = new Set();
  for (const message of messages) {
    if (message.createdTimestamp < sinceMs) continue;
    const post = parseSchedulePost(message.content);
    if (!post) continue;
    if (!post.matchId) {
      unreadable.push(message.url);
      continue;
    }
    if (post.cancelled) {
      records.delete(post.matchId);
      continue;
    }
    const { resolved, unknown } = await resolveCrewNames(post.names, guild, people);
    unknown.forEach((name) => unknownNames.add(name));
    const crew = { ...post.crew, casters: [...new Set([...post.crew.casters, ...(resolved.caster || [])])].slice(0, 2) };
    for (const role of ['producer', 'observer', 'admin', 'social']) crew[role] = crew[role] || resolved[role]?.[0] || null;
    if (!crew.casters.length && !crew.producer && !crew.observer && !crew.admin && !crew.social) {
      unreadable.push(message.url);
      continue;
    }
    const stored = await getStoredMatch(post.matchId);
    const typed = parseScheduleInput(schedulePostDateText(message.content));
    const startIso = await approvedScheduleIso(post.matchId)
      || (post.timestampMs ? new Date(post.timestampMs).toISOString() : null)
      || typed?.iso
      || getFaceitScheduledAtIso(stored?.match)
      || new Date(message.createdTimestamp).toISOString();
    const startMs = Date.parse(startIso);
    if (!inSeason(startMs)) continue;
    records.set(post.matchId, {
      matchId: post.matchId,
      faceitUrl: post.faceitUrl,
      matchup: stored?.match ? `${stored.match.teamA} vs ${stored.match.teamB}` : (post.matchupText || 'Main stream match'),
      startIso: new Date(startMs).toISOString(),
      crew,
      sourceMessageUrl: message.url,
      source: 'schedule-channel'
    });
  }
  const tracked = new Set((await listMainStreamCoverage()).map((coverage) => coverage.matchId));
  const all = [...records.values()];
  const fresh = all.filter((record) => !tracked.has(record.matchId));
  const token = Math.random().toString(36).slice(2, 10);
  pendingCrewImports.set(token, { records: fresh, actorId: interaction.user.id, expiresAt: Date.now() + CREW_IMPORT_TTL_MS });
  const preview = fresh
    .sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso))
    .slice(0, 15)
    .map((record) => {
      const count = record.crew.casters.length + ['producer', 'observer', 'admin', 'social'].filter((role) => record.crew[role]).length;
      return `- ${discordTimestamp(record.startIso, 'd')} · ${record.matchup} · ${count} crew`;
    });
  const lines = [
    `Read ${messages.length} message(s) in <#${channel.id}> back to ${season.startDate}.`,
    `Found **${all.length}** main stream match(es) this season: **${fresh.length}** to import, ${all.length - fresh.length} already kept by the bot.`,
    ...preview,
    fresh.length > preview.length ? `… and ${fresh.length - preview.length} more.` : null,
    unreadable.length ? `\n⚠️ ${unreadable.length} crew post(s) had no FACEIT link or no crew I could read, so they were skipped: ${unreadable.slice(0, 8).join(' ')}` : null,
    unknownNames.size ? `⚠️ Names I couldn't match to Discord (left out): ${[...unknownNames].slice(0, 15).join(', ')}. Link them with \`/cf crewlink\` and run this again.` : null,
    fresh.length ? '\nNothing is saved until you press **Import**. Nobody is pinged or DMed, and the sheet isn\'t touched.' : 'Nothing new to import.'
  ].filter(Boolean);
  await interaction.editReply({
    content: lines.join('\n').slice(0, 2000),
    components: fresh.length ? [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`crew_import:${token}`).setLabel(`Import ${fresh.length} match(es)`).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('crew_import_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    )] : [],
    allowedMentions: { parse: [] }
  });
}

async function handleCrewImportButton(interaction) {
  if (interaction.customId === 'crew_import_cancel') {
    await interaction.update({ content: 'Import canceled. Nothing was saved.', components: [] });
    return;
  }
  if (!canManageStreamRequests(interaction.member)) {
    await interaction.reply({ content: 'Only admins/stream staff can import crews.', ephemeral: true });
    return;
  }
  const token = interaction.customId.slice('crew_import:'.length);
  const pending = pendingCrewImports.get(token);
  pendingCrewImports.delete(token);
  if (!pending || pending.expiresAt < Date.now()) {
    await interaction.update({ content: 'This preview expired. Run `/cf crewimport` again.', components: [] });
    return;
  }
  await saveCrewHistory(pending.records);
  await appendAuditLog({ type: 'crew_history_imported', actorId: interaction.user.id, matches: pending.records.length }).catch(() => null);
  await interaction.update({ content: `Imported ${pending.records.length} main stream match(es). They now count in \`/cf crewstats\`.`, components: [] });
}

// --- Approved schedules vs FACEIT ----------------------------------------------------------
// Every 30 minutes per match (inside the 10-minute sheet sync, a few matches at a time):
// - an approved time the bot couldn't read takes FACEIT's time once FACEIT has one, and the
//   match's sheet row is rewritten with it (so results, prompts and crew stats work too);
// - a sheet row whose write failed is written again;
// - FACEIT showing a different time than the approved one, or no time within 24 hours of the
//   match, alerts staff once (per pair of times).
const SCHEDULE_CHECK_EVERY_MINUTES = 30;
const SCHEDULE_CHECK_PER_RUN = 6;
const SCHEDULE_MISMATCH_TOLERANCE_MS = 5 * 60 * 1000;
const SCHEDULE_SETTLE_MS = 2 * 60 * 60 * 1000;

async function checkApprovedSchedules(sync, now) {
  const due = (await listSchedules()).filter((schedule) => {
    if (!schedule.adminApproved || !schedule.matchId) return false;
    if (!sheetSyncDue(sync[`time:${schedule.matchId}`], now)) return false;
    const startMs = Date.parse(schedule.scheduledAtIso || '');
    if (Number.isFinite(startMs)) return startMs > now - 2 * 60 * 60 * 1000 && startMs < now + 21 * 24 * 60 * 60 * 1000;
    const updatedMs = Date.parse(schedule.updatedAt || '');
    return Number.isFinite(updatedMs) && updatedMs > now - 21 * 24 * 60 * 60 * 1000;
  }).slice(0, SCHEDULE_CHECK_PER_RUN);
  for (const schedule of due) {
    const key = `time:${schedule.matchId}`;
    const entry = sync[key] || {};
    const patch = { nextCheckAt: laterIso(now, SCHEDULE_CHECK_EVERY_MINUTES) };
    const match = await faceit.getMatch(schedule.matchId).catch(() => null);
    if (!match) {
      await updateSheetSync(key, patch);
      continue;
    }
    if (/cancel|finished/i.test(String(match.status || ''))) {
      await updateSheetSync(key, { doneAt: new Date(now).toISOString() });
      continue;
    }
    const faceitIso = getFaceitScheduledAtIso(match);
    const approvedMs = Date.parse(schedule.scheduledAtIso || '');
    const stored = await getStoredMatch(schedule.matchId);
    if (!Number.isFinite(approvedMs)) {
      if (faceitIso) {
        await saveSchedule(schedule.matchId, { scheduledAtIso: faceitIso, scheduledAtIsoSource: 'faceit' });
        const warning = stored
          ? await logScheduleToSheet({ stored, proposal: { ...schedule, scheduledAtIso: faceitIso, scheduledAt: faceitIso }, kind: 'auto-fix' })
          : 'the match is not stored';
        await appendAuditLog({ type: 'schedule_time_from_faceit', matchId: schedule.matchId, sheetUpdated: !warning }).catch(() => null);
        await sendScheduleStaffAlert(stored, [
          `🛠️ **${matchLabel(stored, schedule)}**: the approved time "${String(schedule.scheduledAt || '').slice(0, 60)}" couldn't be read, so I used FACEIT's time, ${discordTimestamp(faceitIso, 'F')}.`,
          warning ? `⚠️ ${warning}` : 'The Google Sheet row is updated.'
        ].join('\n'));
      }
      await updateSheetSync(key, patch);
      continue;
    }
    // A sheet write that failed earlier.
    if (stored && sync[`row:${schedule.matchId}`]?.ok === false) {
      await logScheduleToSheet({ stored, proposal: { ...schedule }, kind: 'retry' });
    }
    if (approvedMs <= now) {
      await updateSheetSync(key, { doneAt: new Date(now).toISOString() });
      continue;
    }
    const settled = now - (Date.parse(schedule.updatedAt || '') || 0) > SCHEDULE_SETTLE_MS;
    const faceitMs = Date.parse(faceitIso || '');
    if (settled && Number.isFinite(faceitMs) && Math.abs(faceitMs - approvedMs) > SCHEDULE_MISMATCH_TOLERANCE_MS) {
      const alertKey = `${schedule.scheduledAtIso}|${faceitIso}`;
      if (entry.mismatchAlerted !== alertKey) {
        await sendScheduleStaffAlert(stored, [
          `⏰ **Time mismatch: ${matchLabel(stored, schedule)}**`,
          `Approved in Discord: ${discordTimestamp(schedule.scheduledAtIso, 'F')}`,
          `FACEIT says: ${discordTimestamp(faceitIso, 'F')}`,
          `Update FACEIT, or reschedule in Discord if FACEIT is right.${stored?.match?.faceitUrl ? ` ${stored.match.faceitUrl}` : ''}`
        ].join('\n'));
        patch.mismatchAlerted = alertKey;
        await appendAuditLog({ type: 'schedule_faceit_mismatch', matchId: schedule.matchId }).catch(() => null);
      }
    } else if (settled && !faceitIso && approvedMs - now < 24 * 60 * 60 * 1000 && entry.missingAlerted !== schedule.scheduledAtIso) {
      await sendScheduleStaffAlert(stored, [
        `⏰ **Not scheduled on FACEIT yet: ${matchLabel(stored, schedule)}**`,
        `Approved for ${discordTimestamp(schedule.scheduledAtIso, 'F')} (${discordTimestamp(schedule.scheduledAtIso, 'R')}), but FACEIT has no time.${stored?.match?.faceitUrl ? ` ${stored.match.faceitUrl}` : ''}`
      ].join('\n'));
      patch.missingAlerted = schedule.scheduledAtIso;
      await appendAuditLog({ type: 'schedule_faceit_missing', matchId: schedule.matchId }).catch(() => null);
    }
    await updateSheetSync(key, patch);
  }
}

function matchLabel(stored, schedule) {
  return stored?.match ? `${stored.match.teamA} vs ${stored.match.teamB}` : schedule.matchId;
}

async function sendScheduleStaffAlert(stored, content) {
  const channel = await getScheduleAdminChannel();
  const channelLink = stored?.discord?.channelId ? ` <#${stored.discord.channelId}>` : '';
  if (!channel?.isTextBased?.()) {
    console.log(`[Schedule check] ${content.replace(/\s+/g, ' ')}`);
    return false;
  }
  return Boolean(await channel.send({
    content: `${getStaffMentions(channel.guild)}\n${content}${channelLink}`.slice(0, 2000),
    allowedMentions: getAdminAllowedMentions(channel.guild)
  }).catch(() => null));
}


// --- Caster prep packs ----------------------------------------------------------------------
// Main stream matches get a prep pack in PREP_CHANNEL_ID PREP_LEAD_MINUTES before the start; it is
// rebuilt every 5 minutes until 2 hours after the start and edited (with a note) when a lineup or
// the maps change. `/cf prep match:<link>` builds one for any match. Season data comes from the
// FACEIT championship match list (cached 10 minutes) and per-match stats (stored once per match,
// filled in the background). Team links and notes come from the "Team Info" tab.

// Lineups and maps are checked every minute (one FACEIT call); the pack is rebuilt only on a change.
// From the match time (or as soon as FACEIT shows the veto running) until the maps are in, every 30s.
const PREP_RECHECK_MS = 60 * 1000;
const PREP_VETO_RECHECK_MS = 30 * 1000;
const PREP_UPDATE_UNTIL_MS = 2 * 60 * 60 * 1000;
const SEASON_MATCHES_TTL_MS = 10 * 60 * 1000;
const TEAM_INFO_SYNC_MS = 30 * 60 * 1000;
let seasonMatchesCache = { at: 0, matches: [] };
let lastTeamInfoErrorLogged = null;

function hasProdRole(member) {
  return Boolean(config.prodRoleId && member?.roles?.cache?.has?.(config.prodRoleId));
}

async function loadSeasonMatches({ force = false } = {}) {
  if (!force && Date.now() - seasonMatchesCache.at < SEASON_MATCHES_TTL_MS && seasonMatchesCache.matches.length) return seasonMatchesCache.matches;
  const season = statsSeason() || activeSeason();
  const all = await faceit.getMatches();
  const matches = all.filter((match) => {
    const ms = prepMatchTimeMs(match);
    return !season || !ms || seasonContains(season, easternParts(ms).dateKey);
  });
  seasonMatchesCache = { at: Date.now(), matches };
  return matches;
}

// Stats for these finished matches: stored ones, plus up to `fetchLimit` fetched now.
async function statsForMatches(matchIds, { fetchLimit = 20 } = {}) {
  const cache = await getMatchStatsCache();
  const found = new Map();
  const fetched = {};
  let fetches = 0;
  for (const matchId of new Set(matchIds)) {
    if (cache[matchId]) {
      found.set(matchId, cache[matchId]);
      continue;
    }
    if (fetches >= fetchLimit) continue;
    fetches += 1;
    const raw = await faceit.getMatchStats(matchId).catch(() => null);
    if (!raw) continue;
    const compact = compactMatchStats(raw);
    if (!compact.maps.length) continue;
    fetched[matchId] = compact;
    found.set(matchId, compact);
  }
  if (Object.keys(fetched).length) await saveMatchStats(fetched);
  return found;
}

// FACEIT map vetoes for these finished matches: stored ones, plus up to `fetchLimit` fetched now.
// A playoff match the bot ran the veto for uses that veto when FACEIT has none.
async function vetoesForMatches(matches, { fetchLimit = 20 } = {}) {
  const cache = await getMatchVetoCache();
  const found = new Map();
  const fetched = {};
  let fetches = 0;
  for (const match of matches) {
    if (!match?.id || found.has(match.id)) continue;
    let entry = cache[match.id];
    if (!entry && fetches < fetchLimit) {
      fetches += 1;
      const payload = await faceit.getMatchVeto(match.id).catch(() => undefined);
      if (payload !== undefined) {
        entry = compactFaceitVeto(payload, match);
        fetched[match.id] = entry;
      }
    }
    if (!entry?.actions?.length) {
      const botVeto = compactBotVeto(await getVeto(match.id).catch(() => null));
      if (botVeto?.actions?.length) entry = botVeto;
    }
    if (entry?.actions?.length) found.set(match.id, entry);
  }
  if (Object.keys(fetched).length) await saveMatchVetoes(fetched);
  return found;
}

// Background: a few finished season matches' stats and vetoes per minute, so prep packs are quick.
async function fillSeasonMatchStats() {
  if (!faceit || !config.faceitApiKey) return;
  const matches = await loadSeasonMatches();
  const finished = matches.filter((match) => /finished/i.test(String(match.status || '')));
  const cache = await getMatchStatsCache();
  const missing = finished.filter((match) => !cache[match.id]).map((match) => match.id);
  if (missing.length) await statsForMatches(missing.slice(0, 5), { fetchLimit: 5 });
  const vetoCache = await getMatchVetoCache();
  const missingVetoes = finished.filter((match) => !vetoCache[match.id]);
  if (missingVetoes.length) await vetoesForMatches(missingVetoes.slice(0, 5), { fetchLimit: 5 });
}

// The current match's FACEIT veto (bans and who picked what), once its maps are locked.
async function currentFaceitVeto(match) {
  if (!match?.raw?.voting?.map?.pick?.length || faceitVetoUnderway(match)) return null;
  const payload = await faceit.getMatchVeto(match.id).catch(() => null);
  return payload ? compactFaceitVeto(payload, match) : null;
}

async function syncTeamInfo(now = Date.now(), { force = false } = {}) {
  if (scheduleSheet.mode !== 'apps-script') return null;
  const cached = await getTeamInfoCache();
  // After a failed read (e.g. the script was not updated yet) try again in 5 minutes, not 30.
  const wait = cached.error ? 5 * 60 * 1000 : TEAM_INFO_SYNC_MS;
  const last = Math.max(Date.parse(cached.syncedAt || '') || 0, Date.parse(cached.errorAt || '') || 0);
  if (!force && now - last < wait) return cached;
  const result = await scheduleSheet.readTeamInfo();
  if (!result.ok) {
    if (result.error !== lastTeamInfoErrorLogged) console.error(`[Team Info] Could not read the Team Info tab: ${result.error}`);
    lastTeamInfoErrorLogged = result.error;
    return saveTeamInfoCache({ error: result.error, errorAt: new Date(now).toISOString() });
  }
  lastTeamInfoErrorLogged = null;
  return saveTeamInfoCache({ teams: parseTeamInfoRows(result.rows), syncedAt: new Date(now).toISOString(), error: null, errorAt: null });
}

async function mainStreamHistory() {
  const history = new Map();
  for (const record of await listCrewHistory()) {
    const startMs = Date.parse(record.startIso || '');
    if (Number.isFinite(startMs)) history.set(record.matchId, { matchId: record.matchId, startMs });
  }
  for (const booking of await crewBookings()) history.set(booking.matchId, { matchId: booking.matchId, startMs: booking.startMs });
  return [...history.values()];
}

async function buildPrepForMatch(matchId) {
  const match = await faceit.getMatch(matchId);
  const seasonMatches = await loadSeasonMatches();
  const teamIds = [match.raw?.teams?.faction1?.faction_id, match.raw?.teams?.faction2?.faction_id].filter(Boolean);
  const names = [match.teamA, match.teamB].map((name) => String(name || '').toLowerCase());
  const relevant = seasonMatches.filter((candidate) => /finished/i.test(String(candidate.status || '')) && [candidate.raw?.teams?.faction1, candidate.raw?.teams?.faction2]
    .some((faction) => (faction?.faction_id && teamIds.includes(faction.faction_id)) || names.includes(String(faction?.name || '').toLowerCase())));
  const group = match.group;
  const groupMatches = group ? seasonMatches.filter((candidate) => candidate.group === group && /finished/i.test(String(candidate.status || ''))) : [];
  const statsById = await statsForMatches([...relevant, ...groupMatches].map((candidate) => candidate.id));
  const vetoById = await vetoesForMatches(relevant);
  const coverage = await getMainStreamCoverage(matchId);
  const stored = await getStoredMatch(matchId);
  // A prep pack always uses a fresh Team Info read when the last one is over 5 minutes old or failed.
  let teamInfoCache = await getTeamInfoCache();
  if (!teamInfoCache.teams || teamInfoCache.error || Date.now() - (Date.parse(teamInfoCache.syncedAt || '') || 0) > 5 * 60 * 1000) {
    teamInfoCache = await syncTeamInfo(Date.now(), { force: true }).catch(() => null) || teamInfoCache;
  }
  const teamInfo = teamInfoCache.teams || [];
  return buildPrepPack({
    match,
    seasonMatches: seasonMatches.some((candidate) => candidate.id === match.id) ? seasonMatches : [...seasonMatches, match],
    statsById,
    vetoById,
    teamInfo,
    veto: await getVeto(matchId).catch(() => null),
    faceitVeto: await currentFaceitVeto(match),
    streamHistory: await mainStreamHistory(),
    startIso: await approvedScheduleIso(matchId) || getFaceitScheduledAtIso(match),
    seasonName: (statsSeason() || activeSeason())?.name || 'Season',
    groupAdvance: config.groupAdvanceCount,
    streamUrl: coverage ? mainStreamUrlFor(coverage) : null,
    matchChannelId: stored?.discord?.channelId || null
  });
}

// Discord allows 6000 characters across all embeds of one message: the longest field values are
// shortened first (with "…") until the post fits.
const PREP_MESSAGE_BUDGET = 5800;

function fitPrepCards(cards, note) {
  const copy = cards.map((card) => ({ ...card, fields: (card.fields || []).map((field) => ({ ...field, value: String(field.value || '—').slice(0, 1024) })) }));
  const size = () => copy.reduce((total, card, index) => total
    + (card.title || '').length
    + ((index === 0 && note ? `${note}\n` : '') + (card.description || '')).length
    + card.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0)
    + (index === 0 ? 70 : 0), 0);
  let guard = 0;
  while (size() > PREP_MESSAGE_BUDGET && guard < 200) {
    guard += 1;
    const longest = copy.flatMap((card) => card.fields).sort((a, b) => b.value.length - a.value.length)[0];
    if (!longest || longest.value.length <= 120) break;
    longest.value = `${longest.value.slice(0, Math.floor(longest.value.length * 0.8)).replace(/\s+\S*$/, '')} …`;
  }
  return copy;
}

function prepEmbeds(pack, { note = null, footer = true } = {}) {
  return fitPrepCards(pack.embeds, note).map((card, index) => {
    const embed = new EmbedBuilder().setTitle(card.title.slice(0, 256)).setColor(index === 0 ? 0x4a86e8 : 0x2b2d31);
    const description = index === 0 && note ? `${note}\n${card.description || ''}` : card.description;
    if (description) embed.setDescription(description.slice(0, 4000));
    if (card.fields?.length) embed.addFields(card.fields.map((field) => ({ name: field.name.slice(0, 256), value: (field.value || '—').slice(0, 1024), inline: Boolean(field.inline) })));
    if (index === 0 && footer) embed.setFooter({ text: 'Caster prep · FACEIT stats this season · /cf prep for any match' });
    return embed;
  });
}

function prepChangeNote(previousSignature, nextSignature, vetoState) {
  const [oldRosters, oldMaps] = String(previousSignature || '').split('#');
  const [newRosters, newMaps] = String(nextSignature || '').split('#');
  const changes = [];
  if (oldMaps !== newMaps) changes.push(vetoState === 'done' ? 'maps are in' : 'maps changed');
  if (oldRosters !== newRosters) changes.push('a lineup changed');
  return changes.length ? `🔄 **Updated <t:${Math.floor(Date.now() / 1000)}:R>: ${changes.join(' and ')}.**` : null;
}

// The operations tick and the 30-second prep timer both call this; a run still in progress makes
// the other skip, so a post or a "maps locked" reply can't go out twice.
let prepPacksRunning = false;
async function runPrepPacks(now = Date.now()) {
  if (prepPacksRunning) return;
  prepPacksRunning = true;
  try {
    await postDuePrepPacks(now);
  } finally {
    prepPacksRunning = false;
  }
}

async function postDuePrepPacks(now = Date.now()) {
  if (!config.prepChannelId || !config.faceitApiKey) return;
  const leadMs = config.prepLeadMinutes * 60 * 1000;
  for (const { coverage, startMs } of await crewBookings()) {
    if (now < startMs - leadMs || now > startMs + PREP_UPDATE_UNTIL_MS) continue;
    const crewIds = [...new Set([...(coverage.crew?.casters || []), coverage.crew?.producer, coverage.crew?.observer].filter(Boolean))];

    // The basic pack goes up PREP_LEAD_MINUTES before the start and pings only the casters.
    if (!coverage.prepMessageId) {
      if (now > startMs + 15 * 60 * 1000) continue;
      const channel = await client.channels.fetch(config.prepChannelId).catch(() => null);
      if (!channel?.isTextBased?.()) return;
      const pack = await buildPrepForMatch(coverage.matchId).catch((error) => {
        console.error(`[Prep] ${coverage.matchId}: ${error.message || error}`);
        return null;
      });
      if (!pack) continue;
      const casters = (coverage.crew?.casters || []).filter(Boolean);
      const message = await channel.send({
        content: `🎙️ Prep for **${coverage.matchup}** (main stream)${casters.length ? ` · ${casters.map((id) => `<@${id}>`).join(' ')}` : ''}`,
        embeds: prepEmbeds(pack),
        allowedMentions: { parse: [], users: casters }
      }).catch(() => null);
      if (!message) continue;
      // Team notes (pronunciation, notes) as their own replies, only for teams that have some.
      for (const card of pack.notes || []) {
        await channel.send({ embeds: prepEmbeds({ embeds: [card] }, { footer: false }), reply: { messageReference: message.id, failIfNotExists: false }, allowedMentions: { parse: [], repliedUser: false } }).catch(() => null);
      }
      await saveMainStreamCoverage(coverage.matchId, { prepChannelId: channel.id, prepMessageId: message.id, prepSignature: pack.signature, prepCheckedAt: new Date(now).toISOString() });
      // Maps already locked (e.g. a playoff veto done early): the crew gets the maps ping now.
      if (pack.maps.length) {
        await replyToPrep({ ...coverage, prepChannelId: channel.id, prepMessageId: message.id }, mapsLockedText(coverage, pack, false), crewIds, pack.mapFacts ? [pack.mapFacts] : []);
      }
      await appendAuditLog({ type: 'prep_pack_posted', matchId: coverage.matchId }).catch(() => null);
      continue;
    }

    // Every minute, and every 30 seconds from the match time (or once FACEIT shows the veto
    // running) until the maps are in.
    const mapsIn = Boolean(String(coverage.prepSignature || '').split('#')[1]);
    const waitingOnVeto = !mapsIn && (now >= startMs || coverage.prepVetoUnderway);
    const recheckMs = waitingOnVeto ? PREP_VETO_RECHECK_MS : PREP_RECHECK_MS;
    // A couple of seconds of slack so timer jitter doesn't push a check to the next run.
    if (now - (Date.parse(coverage.prepCheckedAt || '') || 0) < recheckMs - 2000) continue;
    const current = await faceit.getMatch(coverage.matchId).catch(() => null);
    await saveMainStreamCoverage(coverage.matchId, {
      prepCheckedAt: new Date(now).toISOString(),
      ...(current ? { prepVetoUnderway: faceitVetoUnderway(current) } : {})
    });
    if (!current) continue;
    const veto = await getVeto(coverage.matchId).catch(() => null);
    const quick = vetoSummary({ veto, match: current });
    if (prepSignature(current, quick) === coverage.prepSignature) continue;
    const pack = await buildPrepForMatch(coverage.matchId).catch(() => null);
    if (!pack || pack.signature === coverage.prepSignature) continue;
    const channel = await client.channels.fetch(coverage.prepChannelId).catch(() => null);
    const message = channel?.isTextBased?.() ? await channel.messages.fetch(coverage.prepMessageId).catch(() => null) : null;
    if (!message) continue;
    await message.edit({ embeds: prepEmbeds(pack, { note: prepChangeNote(coverage.prepSignature, pack.signature, pack.vetoState) }) }).catch(() => null);
    const mapsBefore = String(coverage.prepSignature || '').split('#')[1] || '';
    const mapsNow = pack.maps.join(',');
    // Editing a post notifies nobody, so the maps locking (or changing) gets a reply that pings the
    // whole crew: casters, producer and observer. This is the producer's and observer's first ping.
    if (pack.maps.length && mapsNow !== mapsBefore) {
      await replyToPrep(coverage, mapsLockedText(coverage, pack, Boolean(mapsBefore)), crewIds, pack.mapFacts ? [pack.mapFacts] : []);
      await appendAuditLog({ type: 'prep_maps_locked', matchId: coverage.matchId, maps: pack.maps }).catch(() => null);
    }
    await saveMainStreamCoverage(coverage.matchId, { prepSignature: pack.signature });
  }
}

function mapsLockedText(coverage, pack, changed) {
  // The full veto in order when we have it; otherwise just the maps.
  if (pack.vetoOrder?.length) {
    return [`🗺️ ${changed ? 'Maps changed' : 'Maps locked'} for **${coverage.matchup}**`, ...pack.vetoOrder].join('\n');
  }
  return [
    `🗺️ ${changed ? 'Maps changed' : 'Maps locked'} for **${coverage.matchup}**: ${pack.maps.map((map, index) => `${index + 1}. ${map}`).join(' · ')}`,
    pack.bans?.length ? `Bans: ${pack.bans.join(' · ')}` : null
  ].filter(Boolean).join('\n');
}

async function replyToPrep(coverage, content, userIds = [], cards = []) {
  const channel = coverage.prepChannelId ? await client.channels.fetch(coverage.prepChannelId).catch(() => null) : null;
  if (!channel?.isTextBased?.()) return null;
  const mentions = userIds.length ? ` ${userIds.map((id) => `<@${id}>`).join(' ')}` : '';
  return channel.send({
    content: `${content}${mentions}`.slice(0, 2000),
    embeds: cards.length ? prepEmbeds({ embeds: cards }, { footer: false }) : [],
    reply: coverage.prepMessageId ? { messageReference: coverage.prepMessageId, failIfNotExists: false } : undefined,
    allowedMentions: { parse: [], users: userIds, repliedUser: false }
  }).catch(() => null);
}

async function handlePrepCommand(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const parsed = parseFaceitMatchRoomLink(interaction.options.getString('match', true));
  if (!parsed) {
    await interaction.editReply('That is not a FACEIT matchroom link.');
    return;
  }
  try {
    const pack = await buildPrepForMatch(parsed.matchId);
    await interaction.editReply({ embeds: prepEmbeds(pack) });
    for (const card of [...(pack.notes || []), pack.mapFacts].filter(Boolean)) {
      await interaction.followUp({ embeds: prepEmbeds({ embeds: [card] }, { footer: false }), ephemeral: true }).catch(() => null);
    }
  } catch (error) {
    await interaction.editReply(`Couldn't build the prep pack: ${error.message || error}`.slice(0, 2000));
  }
}

async function handleTeamNotesCommand(interaction) {
  if (!hasProdRole(interaction.member) && !canManageStreamRequests(interaction.member)) {
    await interaction.editReply('Only the production team and stream staff can edit team notes.');
    return;
  }
  const team = interaction.options.getString('team', true).trim();
  const clear = (value) => /^(none|clear|remove|-)$/i.test(String(value || '').trim());
  const fields = {};
  const problems = [];
  const text = (option, header) => {
    const value = interaction.options.getString(option);
    if (value === null || value === undefined) return;
    fields[header] = clear(value) ? { clear: true } : { text: value.trim() };
  };
  const link = (option, header) => {
    const value = interaction.options.getString(option);
    if (value === null || value === undefined) return;
    if (clear(value)) {
      fields[header] = { clear: true };
      return;
    }
    const url = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;
    try {
      new URL(url);
      fields[header] = { link: url, label: header };
    } catch {
      problems.push(`${header} link isn't a valid URL.`);
    }
  };
  text('pronunciation', 'Pronunciation');
  text('notes', 'Notes');
  link('hltv', 'HLTV');
  link('liquipedia', 'Liquipedia');
  for (const [option, header] of [['x', 'X']]) {
    const value = interaction.options.getString(option);
    if (value === null || value === undefined) continue;
    if (clear(value)) {
      fields[header] = { clear: true };
      continue;
    }
    const handle = normalizeHandle(value);
    if (handle) fields[header] = { text: handle };
    else problems.push(`${header} should be a handle like @team or a profile link.`);
  }
  if (problems.length) {
    await interaction.editReply(problems.join(' '));
    return;
  }
  if (!Object.keys(fields).length) {
    const cache = await syncTeamInfo(Date.now(), { force: true }) || await getTeamInfoCache();
    if (cache.error) {
      await interaction.editReply(`I couldn't read the Team Info tab: ${cache.error}`);
      return;
    }
    const info = findTeamInfo(cache.teams || [], team);
    await interaction.editReply(info
      ? [
        `**${info.name}** on the Team Info tab:`,
        `Pronunciation: ${info.pronunciation || '—'}`,
        `Notes: ${info.notes || '—'}`,
        `X: ${teamSocials(info).x || '—'}`,
        ...Object.entries(info.links).filter(([label]) => !['x', 'twitter', 'instagram', 'ig'].includes(label)).map(([label, url]) => `${label}: <${url}>`),
        'Change any of it with the options on this command (`none` clears one).'
      ].join('\n')
      : `**${team}** isn't on the Team Info tab yet. Add something with the options on this command.`);
    return;
  }
  const result = await scheduleSheet.updateTeamInfo(team, fields);
  if (!result.ok) {
    await interaction.editReply(`The Team Info tab wasn't updated: ${result.error}`);
    return;
  }
  await syncTeamInfo(Date.now(), { force: true }).catch(() => null);
  await appendAuditLog({ type: 'team_info_updated', actorId: interaction.user.id, team, fields: Object.keys(fields) }).catch(() => null);
  await interaction.editReply(`${result.created ? 'Added' : 'Updated'} **${team}** on the Team Info tab (${Object.keys(fields).join(', ')}). It shows in prep packs from now on.`);
}

async function handleTeamNotesAutocomplete(interaction) {
  const query = String(interaction.options.getFocused() || '').toLowerCase();
  const names = new Set();
  for (const match of seasonMatchesCache.matches) {
    if (match.teamA) names.add(match.teamA);
    if (match.teamB) names.add(match.teamB);
  }
  for (const team of (await getTeamInfoCache()).teams || []) {
    if (![...names].some((name) => teamKey(name) === team.key)) names.add(team.name);
  }
  if (!names.size) {
    for (const stored of await listStoredMatches()) {
      if (stored.match?.teamA) names.add(stored.match.teamA);
      if (stored.match?.teamB) names.add(stored.match.teamB);
    }
  }
  await interaction.respond([...names]
    .filter((name) => !query || name.toLowerCase().includes(query))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 25)
    .map((name) => ({ name: name.slice(0, 100), value: name.slice(0, 100) })))
    .catch(() => null);
}


// --- Social info for the Social Media team -----------------------------------------------
// Facts, not finished posts, in SOCIAL_CHANNEL_ID with no pings:
// - daily at SOCIAL_POST_TIME (4 PM ET): "Tonight on stream", the main stream games with their
//   production crew (casters, producer, observer) and every community-cast game with its channels;
//   edited when crews or casts change;
// - SOCIAL_CARD_LEAD_MINUTES (2 hours) before each main stream match: a card with time, stream,
//   crew, round, team tags, storylines, players to watch and maps; "LIVE NOW" at the start; the
//   final result and top player when FACEIT finishes it;
// Team X handles come from the Team Info tab (X column).

const SOCIAL_REFRESH_MS = 5 * 60 * 1000;
const SOCIAL_CARD_UNTIL_MS = 6 * 60 * 60 * 1000;

async function socialTeams() {
  let cache = await getTeamInfoCache();
  if (!cache.teams || cache.error || Date.now() - (Date.parse(cache.syncedAt || '') || 0) > TEAM_INFO_SYNC_MS) {
    cache = await syncTeamInfo(Date.now(), { force: !cache.teams }).catch(() => null) || cache;
  }
  return cache.teams || [];
}

function teamsOf(matchup, fallbackA = null, fallbackB = null) {
  if (fallbackA && fallbackB) return [fallbackA, fallbackB];
  const [teamA = matchup || 'TBD', teamB = 'TBD'] = String(matchup || '').split(/\s+vs\.?\s+/i).map((team) => team.trim());
  return [teamA, teamB];
}

async function streamedMatchesBetween(startKey, endKey) {
  const teams = await socialTeams();
  const socials = (name) => teamSocials(findTeamInfo(teams, name));
  const inRange = (ms) => {
    const key = sheetSlotFor(ms).dateKey;
    return key >= startKey && key <= endKey;
  };
  const main = (await crewBookings())
    .filter((booking) => inRange(booking.startMs))
    .map(({ coverage, startMs }) => {
      const [teamA, teamB] = teamsOf(coverage.matchup, coverage.teamA, coverage.teamB);
      return { matchId: coverage.matchId, startMs, teamA, teamB, socialsA: socials(teamA), socialsB: socials(teamB), streamUrl: mainStreamUrlFor(coverage), crew: coverage.crew || {}, kind: 'main' };
    });
  const mainIds = new Set(main.map((match) => match.matchId));
  const byMatch = new Map();
  for (const request of await listStreamRequests({ status: 'approved' })) {
    if (/cancel/i.test(String(request.faceitStatus || ''))) continue;
    const startMs = Date.parse(castTimeIso(request) || '');
    if (!Number.isFinite(startMs) || !inRange(startMs) || !request.streamUrl) continue;
    const key = request.matchId || request.id;
    if (!byMatch.has(key)) {
      const [teamA, teamB] = teamsOf(request.matchup);
      byMatch.set(key, { matchId: request.matchId || null, startMs, teamA, teamB, socialsA: socials(teamA), socialsB: socials(teamB), casts: [], alsoMainStream: mainIds.has(request.matchId), kind: 'community' });
    }
    byMatch.get(key).casts.push({ url: request.streamUrl, userId: request.requesterId });
  }
  return { main, community: [...byMatch.values()] };
}

function socialEmbed(card, color = 0xe91e63) {
  return new EmbedBuilder().setTitle(card.title.slice(0, 256)).setDescription(card.description.slice(0, 4096)).setColor(color);
}

async function socialChannel() {
  if (!config.socialChannelId) return null;
  const channel = await client.channels.fetch(config.socialChannelId).catch(() => null);
  return channel?.isTextBased?.() ? channel : null;
}

async function postOrEditSocial(key, card, { color, skipIfEmpty = false, empty = false, replyTo = null } = {}) {
  const sync = await getSheetSync();
  const entry = sync[key] || {};
  const hash = `${card.title}\n${card.description}`;
  if (entry.messageId && entry.hash === hash) return;
  if (!entry.messageId && skipIfEmpty && empty) return;
  const channel = await socialChannel();
  if (!channel) return;
  if (entry.messageId) {
    const message = await channel.messages.fetch(entry.messageId).catch(() => null);
    if (message) {
      await message.edit({ embeds: [socialEmbed(card, color)], allowedMentions: { parse: [] } }).catch(() => null);
      await updateSheetSync(key, { hash });
      return;
    }
  }
  const message = await channel.send({
    embeds: [socialEmbed(card, color)],
    reply: replyTo ? { messageReference: replyTo, failIfNotExists: false } : undefined,
    allowedMentions: { parse: [], repliedUser: false }
  }).catch(() => null);
  if (message) await updateSheetSync(key, { messageId: message.id, channelId: channel.id, hash, postedAt: new Date().toISOString() });
  return message;
}

let lastSocialRefreshAt = 0;

async function runSocialInfo(now = Date.now()) {
  if (!config.socialChannelId) return;
  const [hour, minute] = config.socialPostTime.split(':').map(Number);
  const { dateKey, minutes } = easternParts(now);
  const postMinutes = hour * 60 + minute;
  const due = minutes >= postMinutes;
  // Cards per main stream match run every minute (their timing matters); the roundup every 5.
  await refreshSocialCards(now).catch((error) => console.error('[Social] match cards failed:', error.message || error));
  if (!due || now - lastSocialRefreshAt < SOCIAL_REFRESH_MS) return;
  lastSocialRefreshAt = now;

  // Daily roundup (posted once there is something on stream tonight; edited as crews/casts change).
  const tonight = await streamedMatchesBetween(dateKey, dateKey);
  await postOrEditSocial(`social:roundup:${dateKey}`, buildRoundup({ dateMs: now, mainStream: tonight.main, community: tonight.community }), {
    skipIfEmpty: true,
    empty: !tonight.main.length && !tonight.community.length
  });
}

// One card per main stream match: posted SOCIAL_CARD_LEAD_MINUTES before, "LIVE NOW" at the start,
// the result when FACEIT finishes it. Checked every minute; FACEIT is asked every 5 minutes.
async function refreshSocialCards(now = Date.now()) {
  const leadMs = config.socialCardLeadMinutes * 60 * 1000;
  for (const { coverage, startMs } of await crewBookings()) {
    if (now < startMs - leadMs || now > startMs + SOCIAL_CARD_UNTIL_MS || coverage.socialDone) continue;
    const [teamA, teamB] = teamsOf(coverage.matchup, coverage.teamA, coverage.teamB);
    let facts = coverage.socialFacts || null;
    if (!facts) {
      if (now > startMs + 30 * 60 * 1000) continue;
      const pack = await buildPrepForMatch(coverage.matchId).catch(() => null);
      facts = pack?.social || { storylines: [], stars: [], maps: [] };
      await saveMainStreamCoverage(coverage.matchId, { socialFacts: facts });
    }
    const checkedMs = Date.parse(coverage.socialCheckedAt || '') || 0;
    let { maps = [] } = facts;
    let state = now >= startMs ? 'live' : 'upcoming';
    let result = null;
    let topPlayer = null;
    if (now - checkedMs >= SOCIAL_REFRESH_MS || !coverage.socialMessageId) {
      const match = await faceit.getMatch(coverage.matchId).catch(() => null);
      if (match) {
        maps = vetoSummary({ veto: await getVeto(coverage.matchId).catch(() => null), match }).maps.map((entry) => entry.map);
        if (/ongoing|live/i.test(String(match.status || ''))) state = 'live';
        if (/finished/i.test(String(match.status || ''))) {
          const raw = await faceit.getMatchStats(coverage.matchId).catch(() => null);
          result = buildMatchResult(match, raw)?.text || null;
          const compact = raw ? compactMatchStats(raw) : null;
          if (compact?.maps?.length) await saveMatchStats({ [coverage.matchId]: compact });
          topPlayer = matchTopPlayer(compact);
          state = 'done';
        }
      }
      await saveMainStreamCoverage(coverage.matchId, { socialCheckedAt: new Date(now).toISOString(), socialFacts: { ...facts, maps } });
    } else if (coverage.socialState === 'done') {
      continue;
    }
    const teams = await socialTeams();
    const socialsA = teamSocials(findTeamInfo(teams, teamA));
    const socialsB = teamSocials(findTeamInfo(teams, teamB));
    const finished = state === 'done' && Boolean(result);
    // Before-game post: facts, LIVE NOW while it's on, plain facts again once it's over.
    const cardState = finished ? 'over' : state === 'done' ? 'live' : state;
    const card = buildSocialCard({
      startMs,
      teamA,
      teamB,
      socialsA,
      socialsB,
      streamUrl: mainStreamUrlFor(coverage),
      crew: coverage.crew || {},
      round: facts.round,
      group: facts.group,
      storylines: facts.storylines,
      stars: facts.stars,
      stakes: facts.stakes || [],
      form: facts.form || null,
      h2h: facts.h2h || null,
      maps,
      state: cardState
    });
    await postOrEditSocial(`social:card:${coverage.matchId}`, card, { color: cardState === 'live' ? 0xe74c3c : 0xe91e63 });
    // After-game post: its own message, as a reply to the before-game one.
    if (finished) {
      const before = (await getSheetSync())[`social:card:${coverage.matchId}`];
      const resultCard = buildSocialResultCard({ teamA, teamB, socialsA, socialsB, streamUrl: mainStreamUrlFor(coverage), result, topPlayer });
      await postOrEditSocial(`social:result:${coverage.matchId}`, resultCard, { color: 0xf1c40f, replyTo: before?.messageId || null });
    }
    if (state !== coverage.socialState || (state === 'done' && result)) {
      await saveMainStreamCoverage(coverage.matchId, { socialState: state, ...(state === 'done' && result ? { socialDone: true } : {}) });
    }
  }
}
