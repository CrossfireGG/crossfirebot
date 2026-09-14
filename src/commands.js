import {
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';

const roundChoices = [
  { name: 'All detected rounds', value: 'all' },
  { name: 'Upper Bracket - Round 1', value: 'upper-r1' },
  { name: 'Upper Bracket - Round 2 + Lower Bracket - Round 1', value: 'upper-r2-lower-r1' },
  { name: 'Upper Bracket - Round 3 + Lower Bracket - Round 2', value: 'upper-r3-lower-r2' },
  { name: 'Lower Bracket - Round 3', value: 'lower-r3' },
  { name: 'Upper Bracket - Round 4 + Lower Bracket - Round 4', value: 'upper-r4-lower-r4' },
  { name: 'Lower Bracket - Round 5', value: 'lower-r5' },
  { name: 'Upper Bracket - Round 5 + Lower Bracket - Round 6', value: 'upper-r5-lower-r6' },
  { name: 'Lower Bracket - Round 7', value: 'lower-r7' },
  { name: 'Lower Bracket - Final', value: 'lower-final' },
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
            .setDescription('For match sync: only sync one playoff round window')
            .setRequired(false)
            .addChoices(...roundChoices)
        )
        .addBooleanOption((option) =>
          option
            .setName('notify_captains')
            .setDescription('For team sync: DM captains about missing players')
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
            .setDescription('For match audit: only audit one playoff round window')
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
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map((command) => command.toJSON());
