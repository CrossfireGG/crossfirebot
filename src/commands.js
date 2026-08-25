import {
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('matches')
    .setDescription('Manage FACEIT match channels')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('sync')
        .setDescription('Create or update Discord match channels from FACEIT')
        .addIntegerOption((option) =>
          option
            .setName('round')
            .setDescription('Only sync one Group Stage round')
            .setRequired(false)
            .addChoices(
              { name: 'All detected rounds', value: 0 },
              { name: 'Group Stage - Round 1', value: 1 },
              { name: 'Group Stage - Round 2', value: 2 },
              { name: 'Group Stage - Round 3', value: 3 }
            )
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('status')
        .setDescription('Show how many FACEIT matches are stored by the bot')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('sample')
        .setDescription('Create a sample match channel for testing')
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
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('teams')
    .setDescription('Manage team roles and roster checks')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('sync')
        .setDescription('Update team roles, participant roles, captain roles, and nicknames from Google Sheet')
        .addBooleanOption((option) =>
          option
            .setName('notify_captains')
            .setDescription('DM captains about missing players')
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('missing-players')
        .setDescription('Show which sheet players are missing from this Discord server')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('missing-captains')
        .setDescription('Show which sheet team captains are missing from this Discord server')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map((command) => command.toJSON());
