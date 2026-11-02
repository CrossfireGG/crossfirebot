import { SlashCommandBuilder } from 'discord.js';

const roundChoices = [
  { name: 'All detected rounds', value: 'all' },
  { name: 'Group Stage - Round 1', value: '1' },
  { name: 'Group Stage - Round 2', value: '2' },
  { name: 'Group Stage - Round 3', value: '3' },
  { name: 'Upper Bracket - Round 1', value: 'upper-r1' },
  { name: 'Upper Bracket - Round 2 + Lower Bracket - Round 1', value: 'upper-r2-lower-r1' },
  { name: 'Upper Bracket - Round 3 + Lower Bracket - Round 2', value: 'upper-r3-lower-r2' },
  { name: 'Lower Bracket - Round 3', value: 'lower-r3' },
  { name: 'Upper Bracket - Round 4 + Lower Bracket - Round 4', value: 'upper-r4-lower-r4' },
  { name: 'Lower Bracket - Round 5', value: 'lower-r5' },
  { name: 'Upper Bracket - Round 5 + Lower Bracket - Round 6', value: 'upper-r5-lower-r6' },
  { name: 'Lower Bracket - Round 7', value: 'lower-r7' },
  { name: 'Lower Bracket - Round 8', value: 'lower-r8' },
  { name: 'Grand Final (BO5)', value: 'grand-final' }
];

export const commands = [
  new SlashCommandBuilder()
    .setName('cf')
    .setDescription('CROSSFIRE bot admin tools')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('sync')
        .setDescription('Sync match rooms or team roles')
        .addStringOption((option) =>
          option
            .setName('target')
            .setDescription('What to sync')
            .setRequired(true)
            .addChoices(
              { name: 'matches', value: 'matches' },
              { name: 'teams', value: 'teams' }
            )
        )
        .addStringOption((option) =>
          option
            .setName('round')
            .setDescription('For match sync: only sync one group-stage or playoff round')
            .setRequired(false)
            .addChoices(...roundChoices)
        )
        .addBooleanOption((option) =>
          option
            .setName('notify_captains')
            .setDescription('For team sync: DM captains about missing players')
            .setRequired(false)
        )
        .addBooleanOption((option) =>
          option
            .setName('dry_run')
            .setDescription('Preview team sync changes without changing Discord')
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('audit')
        .setDescription('Check match rooms or missing roster users')
        .addStringOption((option) =>
          option
            .setName('target')
            .setDescription('What to audit')
            .setRequired(true)
            .addChoices(
              { name: 'matches', value: 'matches' },
              { name: 'players', value: 'players' },
              { name: 'captains', value: 'captains' }
            )
        )
        .addStringOption((option) =>
          option
            .setName('round')
            .setDescription('For match audit: only audit one group-stage or playoff round')
            .setRequired(false)
            .addChoices(...roundChoices)
        )
        .addBooleanOption((option) =>
          option
            .setName('fix')
            .setDescription('For match audit: repair channel names, links, and permissions')
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('refresh')
        .setDescription('Refresh match channel status emojis')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('status')
        .setDescription('Show how many matches the bot knows about')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('commands')
        .setDescription('Show the admin command list')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('create')
        .setDescription('Create or update one match room from a FACEIT link')
        .addStringOption((option) =>
          option
            .setName('link')
            .setDescription('FACEIT match room link')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('sample')
        .setDescription('Create a sample match room for testing')
        .addStringOption((option) =>
          option
            .setName('group')
            .setDescription('Group letter for the sample match')
            .setRequired(false)
        )
        .addIntegerOption((option) =>
          option
            .setName('round')
            .setDescription('Group Stage round number')
            .setRequired(false)
            .addChoices(
              { name: 'Group Stage - Round 1', value: 1 },
              { name: 'Group Stage - Round 2', value: 2 },
              { name: 'Group Stage - Round 3', value: 3 }
            )
        )
        .addStringOption((option) =>
          option
            .setName('team_a')
            .setDescription('First sample team name')
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName('team_b')
            .setDescription('Second sample team name')
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('mappings')
        .setDescription('Manage persistent team mappings')
        .addStringOption((option) => option.setName('action').setDescription('Mapping action').setRequired(true).addChoices(
          { name: 'list', value: 'list' },
          { name: 'inspect', value: 'inspect' },
          { name: 'link/correct', value: 'link' },
          { name: 'repair match rooms', value: 'repair' }
        ))
        .addStringOption((option) => option.setName('team').setDescription('Team name or persistent identity').setRequired(false))
        .addStringOption((option) => option.setName('faceit_team_id').setDescription('FACEIT team UUID').setRequired(false))
        .addRoleOption((option) => option.setName('role').setDescription('Discord team role').setRequired(false))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('veto')
        .setDescription('Start, inspect, reset, cancel, or override a veto')
        .addStringOption((option) => option.setName('action').setDescription('Veto action').setRequired(true).addChoices(
          { name: 'start', value: 'start' },
          { name: 'inspect', value: 'inspect' },
          { name: 'reset', value: 'reset' },
          { name: 'cancel', value: 'cancel' },
          { name: 'set seeds', value: 'seeds' }
        ))
        .addChannelOption((option) => option.setName('match_room').setDescription('Linked Discord match room').setRequired(false))
        .addIntegerOption((option) => option.setName('team_a_seed').setDescription('Team A tournament seed').setRequired(false).setMinValue(1))
        .addIntegerOption((option) => option.setName('team_b_seed').setDescription('Team B tournament seed').setRequired(false).setMinValue(1))
        .addStringOption((option) => option.setName('advantage_team').setDescription('Grand Final upper-bracket winner').setRequired(false).addChoices(
          { name: 'Team A', value: 'teamA' },
          { name: 'Team B', value: 'teamB' }
        ))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('streams')
        .setDescription('Review and manage streamer requests')
        .addStringOption((option) => option.setName('action').setDescription('Request action').setRequired(true).addChoices(
          { name: 'list pending', value: 'pending' },
          { name: 'list approved', value: 'approved' },
          { name: 'list website publish failures', value: 'publish_failed' },
          { name: 'inspect', value: 'inspect' },
          { name: 'retry website publish', value: 'retry' },
          { name: 'cancel request', value: 'cancel' },
          { name: 'revoke approval', value: 'revoke' },
          { name: 'mark match completed', value: 'complete' },
          { name: 'mark post-cast form received', value: 'form_received' }
        ))
        .addStringOption((option) => option.setName('request_id').setDescription('Streamer request ID').setRequired(false))
        .addStringOption((option) => option.setName('reason').setDescription('Reason for cancel/revoke/completion').setRequired(false))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('auditlog')
        .setDescription('Show recent scheduling and operations audit events')
        .addStringOption((option) => option.setName('match_id').setDescription('Optional FACEIT match ID').setRequired(false))
    )
  ,
  new SlashCommandBuilder()
    .setName('request')
    .setDescription('Request permission to stream a CROSSFIRE match')
    .addSubcommand((subcommand) => subcommand.setName('stream').setDescription('Open the stream request form'))
    .addSubcommand((subcommand) => subcommand.setName('cancel').setDescription('Cancel a pending request or withdraw from a cast you were approved for')
      .addStringOption((option) => option.setName('request_id').setDescription('Pick one of your active requests').setRequired(true).setAutocomplete(true))),
  new SlashCommandBuilder()
    .setName('crossfire')
    .setDescription('CROSSFIRE match and operations information')
    .addSubcommand((subcommand) => subcommand.setName('upcoming').setDescription('Show upcoming approved matches'))
    .addSubcommand((subcommand) => subcommand.setName('team').setDescription('Show a team’s matches and schedule status')
      .addStringOption((option) => option.setName('name').setDescription('Team name').setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName('rounds').setDescription('Show configured round windows and defaults'))
    .addSubcommand((subcommand) => subcommand.setName('veto').setDescription('Show veto status for this match room'))
    .addSubcommand((subcommand) => subcommand.setName('help').setDescription('Show CROSSFIRE command help and rules links'))
].map((command) => command.toJSON());
