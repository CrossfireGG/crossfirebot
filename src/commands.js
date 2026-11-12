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
        .setDescription('See, inspect or cancel community caster requests')
        .addStringOption((option) => option.setName('action').setDescription('What to do').setRequired(true).addChoices(
          { name: 'list active requests', value: 'list' },
          { name: 'inspect one request', value: 'inspect' },
          { name: 'cancel requests', value: 'cancel' }
        ))
        .addStringOption((option) => option.setName('request_id').setDescription('Request ID (inspect, or cancel one request)').setRequired(false))
        .addStringOption((option) => option.setName('match').setDescription('Cancel every request on this FACEIT matchroom link').setRequired(false))
        .addUserOption((option) => option.setName('caster').setDescription('Cancel every active request from this caster').setRequired(false))
        .addStringOption((option) => option.setName('reason').setDescription('Reason sent to the caster when canceling').setRequired(false))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('season')
        .setDescription('Set up seasons and their round dates')
        .addStringOption((option) => option.setName('action').setDescription('Season action').setRequired(true).addChoices(
          { name: 'list seasons', value: 'list' },
          { name: 'start a new season', value: 'start' },
          { name: 'edit round dates', value: 'rounds' },
          { name: 'rename or change dates', value: 'edit' },
          { name: 'end season', value: 'end' },
          { name: 'delete season', value: 'delete' },
          { name: 'set CSTV password', value: 'password' }
        ))
        .addStringOption((option) => option.setName('season').setDescription('Season to change (defaults to the current one)').setRequired(false).setAutocomplete(true))
        .addStringOption((option) => option.setName('name').setDescription('Season name, e.g. Season 8').setRequired(false).setMaxLength(60))
        .addStringOption((option) => option.setName('start').setDescription('Start date, e.g. 1/10/2027').setRequired(false))
        .addStringOption((option) => option.setName('end').setDescription('End date, e.g. 3/15/2027').setRequired(false))
        .addStringOption((option) => option.setName('password').setDescription('CSTV password, sent as: password "PW"; connect IP:PORT (none to remove)').setRequired(false).setMaxLength(200))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('forms')
        .setDescription('Post-cast forms: who has submitted and who is missing')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('tickets')
        .setDescription('Post the "Open a ticket" panel (support, match issues, roster changes, applications) here')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('mainstream')
        .setDescription('Put a match on the main stream, change its stream or crew, or take it off')
        .addStringOption((option) => option.setName('match').setDescription('FACEIT matchroom link (leave empty inside the match channel)').setRequired(false))
        .addStringOption((option) => option.setName('stream').setDescription('Which CROSSFIRE stream (default: the first one)').setRequired(false).setAutocomplete(true))
        .addStringOption((option) => option.setName('caster1').setDescription('Caster 1 (needed to post the crew); suggestions show who is free').setRequired(false).setAutocomplete(true))
        .addStringOption((option) => option.setName('producer').setDescription('Producer (needed to post the crew); suggestions show who is free').setRequired(false).setAutocomplete(true))
        .addStringOption((option) => option.setName('caster2').setDescription('Caster 2').setRequired(false).setAutocomplete(true))
        .addStringOption((option) => option.setName('observer').setDescription('Observer').setRequired(false).setAutocomplete(true))
        .addStringOption((option) => option.setName('admin').setDescription('Admin').setRequired(false).setAutocomplete(true))
        .addStringOption((option) => option.setName('social').setDescription('Social Media').setRequired(false).setAutocomplete(true))
        .addBooleanOption((option) => option.setName('remove').setDescription('Take this match off the main stream').setRequired(false))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('whosfree')
        .setDescription('Who on the production/admin crew is free at a time (from the staff schedule sheet)')
        .addStringOption((option) => option.setName('when').setDescription('A day (today, Thurs, 11/12) or a time (Thurs 9:30pm) or a FACEIT link. Empty = today').setRequired(false))
        .addIntegerOption((option) => option.setName('length').setDescription('How long it runs (default from settings)').setRequired(false).addChoices(
          { name: 'BO1 (1.5 hours)', value: 90 },
          { name: 'BO3 (3 hours)', value: 180 },
          { name: 'BO5 (5 hours)', value: 300 }
        ))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('prep')
        .setDescription('Caster prep pack for any match: rosters, records, maps, players, head-to-head')
        .addStringOption((option) => option.setName('match').setDescription('FACEIT matchroom link').setRequired(true))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('crewstats')
        .setDescription('Season counts: community casts per caster, main stream matches per person and role')
        .addUserOption((option) => option.setName('user').setDescription('One person\'s full season').setRequired(false))
        .addStringOption((option) => option.setName('season').setDescription('Season (defaults to the current one)').setRequired(false).setAutocomplete(true))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('crewimport')
        .setDescription('Read this season\'s Schedule channel posts to count main stream crews from before the bot kept them')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('crewlink')
        .setDescription('Link a staff schedule name to a Discord account, or list names the bot could not match')
        .addStringOption((option) => option.setName('name').setDescription('Name as written on the staff schedule').setRequired(false).setAutocomplete(true))
        .addUserOption((option) => option.setName('user').setDescription('Their Discord account').setRequired(false))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('upcoming')
        .setDescription('Post the Upcoming Matches list in the community casters channel now')
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
    .addSubcommand((subcommand) => subcommand.setName('open').setDescription('See every confirmed upcoming match and request one to cast'))
    .addSubcommand((subcommand) => subcommand.setName('mine').setDescription('See your casts, IP status and which post-cast forms are missing'))
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
    .addSubcommand((subcommand) => subcommand.setName('teamnotes').setDescription('Production: see or set a team\'s pronunciation, notes, HLTV and Liquipedia (Team Info tab)')
      .addStringOption((option) => option.setName('team').setDescription('Team').setRequired(true).setAutocomplete(true))
      .addStringOption((option) => option.setName('pronunciation').setDescription('How to say the name (none to clear)').setRequired(false).setMaxLength(100))
      .addStringOption((option) => option.setName('notes').setDescription('Anything casters should know (none to clear)').setRequired(false).setMaxLength(500))
      .addStringOption((option) => option.setName('hltv').setDescription('HLTV team page link (none to clear)').setRequired(false))
      .addStringOption((option) => option.setName('liquipedia').setDescription('Liquipedia page link (none to clear)').setRequired(false))
      .addStringOption((option) => option.setName('x').setDescription('Team X / Twitter handle, e.g. @team (none to clear)').setRequired(false))),
  new SlashCommandBuilder()
    .setName('arena')
    .setDescription('Crossfire Arena 10mans: link your FACEIT so you get moved to your team’s voice channel')
    .addSubcommand((subcommand) => subcommand.setName('link').setDescription('Link your FACEIT account (staff: link someone else)')
      .addStringOption((option) => option.setName('faceit').setDescription('FACEIT nickname or profile link').setRequired(true).setMaxLength(120))
      .addUserOption((option) => option.setName('user').setDescription('Staff only: the Discord member to link').setRequired(false)))
    .addSubcommand((subcommand) => subcommand.setName('unlink').setDescription('Remove your FACEIT link (staff: someone else’s)')
      .addUserOption((option) => option.setName('user').setDescription('Staff only: the Discord member to unlink').setRequired(false))
      .addStringOption((option) => option.setName('faceit').setDescription('Staff only: the FACEIT nickname to unlink').setRequired(false).setMaxLength(120)))
    .addSubcommand((subcommand) => subcommand.setName('whois').setDescription('See which FACEIT account someone is linked to')
      .addUserOption((option) => option.setName('user').setDescription('Who (default: you)').setRequired(false)))
    .addSubcommand((subcommand) => subcommand.setName('status').setDescription('Staff: games with voice channels right now, and how many players are linked'))
    .addSubcommand((subcommand) => subcommand.setName('panel').setDescription('Staff: post the Link FACEIT panel in arena-info'))
    .addSubcommand((subcommand) => subcommand.setName('cleanup').setDescription('Staff: end finished games and delete leftover Arena voice channels')
      .addBooleanOption((option) => option.setName('everything').setDescription('End every game the bot is tracking, even ones still live').setRequired(false)))
].map((command) => command.toJSON());
