import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('sync_matches')
    .setDescription('Create or update Discord match channels from FACEIT')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('match_status')
    .setDescription('Show how many FACEIT matches are stored by the bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('sync_team_roles')
    .setDescription('Assign Discord team roles from the configured Google Sheet')
    .addBooleanOption((option) =>
      option
        .setName('notify_captains')
        .setDescription('DM captains about missing players')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('update_team_roles')
    .setDescription('Safely update team roles, participant roles, captain roles, and nicknames from Google Sheet')
    .addBooleanOption((option) =>
      option
        .setName('notify_captains')
        .setDescription('DM captains about missing players')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('missing_captains')
    .setDescription('Show which sheet team captains are missing from this Discord server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('missing_players')
    .setDescription('Show which sheet players are missing from this Discord server, grouped by team')
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
