import { PermissionFlagsBits } from 'discord.js';

export function isAuthorizedStaffMember(member, config) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator) ||
      member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  const allowed = new Set([
    config.discordStaffRoleId,
    ...(config.authorizedStaffRoleIds || [])
  ].filter(Boolean));
  return [...allowed].some((roleId) => member.roles?.cache?.has(roleId));
}

export function parseForceDirective(value) {
  const text = String(value || '').trim();
  const match = text.match(/\s+--force(?:\s+(.+))?$/i);
  if (!match) return { scheduleText: text, reason: '' };
  return { scheduleText: text.slice(0, match.index).trim(), reason: String(match[1] || '').trim() };
}

export function memberHasMatchAccess(memberRoleIds, matchDiscord, staffRoleIds = []) {
  const allowed = new Set([matchDiscord?.teamARoleId, matchDiscord?.teamBRoleId, ...staffRoleIds].filter(Boolean));
  return memberRoleIds.some((roleId) => allowed.has(roleId));
}
