import {
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';

const roundChoices = [
  { name: 'All detected rounds', value: 0 },
  { name: 'Group Stage - Round 1', value: 1 },
  { name: 'Group Stage - Round 2', value: 2 },
  { name: 'Group Stage - Round 3', value: 3 }
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
              { name: 'Match rooms from FACEIT', value: 'matches' },
              { name: 'Team roles from Google Sheet', value: 'teams' }
            )
        )
        .addIntegerOption((option) =>
          option
            .setName('round')
            .setDescription('For match sync: only sync one Group Stage round')
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
              { name: 'Match rooms and permissions', value: 'matches' },
              { name: 'Missing players', value: 'players' },
              { name: 'Missing captains', value: 'captains' }
            )
        )
        .addIntegerOption((option) =>
          option
            .setName('round')
            .setDescription('For match audit: only audit one Group Stage round')
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
