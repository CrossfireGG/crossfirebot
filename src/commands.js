import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('status')
        .setDescription('Show how many FACEIT matches are stored by the bot')
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

export function scheduleButtons(matchId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`schedule:${matchId}`)
      .setLabel('Propose time')
      .setStyle(ButtonStyle.Primary)
  );
}
