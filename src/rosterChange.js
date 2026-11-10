// Roster changes (/roster-change): a captain adds a player to their team on the "Roster Tracking"
// tab of the Crossfire Player Tracking sheet, removing a player or moving one to a sub slot, and the
// admins are told to update FACEIT. Pure functions; index.js runs the Discord flow and the sheet calls.

// The slots a roster change can use. The coach row is left alone.
export const ROSTER_SLOT_LABELS = ['Starter 1', 'Starter 2', 'Starter 3', 'Starter 4', 'Starter 5', 'Sub 1', 'Sub 2'];

export const isStarterSlot = (label) => /^starter/i.test(String(label || ''));
export const isSubSlot = (label) => /^sub/i.test(String(label || ''));

const PLACEHOLDER = /^(n\/?a|none|-|tbd|\.)$/i;

function clean(value) {
  const text = String(value ?? '').trim();
  return PLACEHOLDER.test(text) ? '' : text;
}

// A slot from the sheet has someone in it when it has a name or an alias.
export function slotTaken(slot) {
  return Boolean(clean(slot?.alias) || clean(slot?.fullName));
}

// "Starter 3 · zoro- (Sam Smith)" / "Sub 2 · empty".
export function slotText(slot) {
  if (!slotTaken(slot)) return `${slot.label} · empty`;
  const alias = clean(slot.alias);
  const name = clean(slot.fullName);
  return `${slot.label} · ${alias || name}${alias && name ? ` (${name})` : ''}`;
}

// The roster slots of a team read from the sheet, in order (coach left out).
export function rosterSlots(team) {
  return (team?.slots || []).filter((slot) => ROSTER_SLOT_LABELS.some((label) => label.toLowerCase() === String(slot.label || '').toLowerCase()));
}

// A Discord ID typed by the captain: <@123>, @123 or 123, 17-20 digits. null when it isn't one.
export function parseDiscordId(value) {
  const text = String(value || '').replace(/[<@!>\s]/g, '');
  return /^\d{17,20}$/.test(text) ? text : null;
}

function normalizeLink(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

// Twitter/X as a link: "@handle", "handle", "x.com/handle" or a full link -> https://x.com/handle.
export function twitterLink(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/(^|\/\/|\.)(x|twitter)\.com\//i.test(text)) return normalizeLink(text);
  const handle = text.replace(/^@/, '').replace(/[^A-Za-z0-9_]/g, '');
  return handle ? `https://x.com/${handle}` : '';
}

// Checks the new player's details. Returns { ok, errors: [field messages], player }.
// player: { alias, fullName, discord, discordId, twitter, nationality, faceit, hltv, steamId }
// (twitter is optional).
export function validateNewPlayer(input = {}) {
  const player = {
    twitter: twitterLink(input.twitter),
    alias: String(input.alias || '').trim(),
    fullName: String(input.fullName || '').trim(),
    discord: String(input.discord || '').trim(),
    discordId: input.discordId || null,
    nationality: String(input.nationality || '').trim(),
    faceit: normalizeLink(input.faceit),
    hltv: normalizeLink(input.hltv),
    steamId: String(input.steamId || '').replace(/\s/g, '')
  };
  const errors = [];
  if (!player.alias) errors.push('IGN is required.');
  if (!player.fullName) errors.push('Full Name is required.');
  if (!player.discord) errors.push('Discord is required: pick the player, or type their Discord ID.');
  if (!player.nationality) errors.push('Nationality is required.');
  if (!player.faceit) errors.push('FACEIT Profile is required.');
  else if (!/faceit\.com/i.test(player.faceit)) errors.push('FACEIT Profile must be a faceit.com link.');
  if (!player.hltv) errors.push('HLTV Profile is required.');
  else if (!/hltv\.org/i.test(player.hltv)) errors.push('HLTV Profile must be an hltv.org link.');
  if (!player.steamId) errors.push('SteamID64 is required.');
  else if (!/^7656119\d{10}$/.test(player.steamId)) errors.push('SteamID64 must be 17 digits and start with 7656119.');
  return { ok: errors.length === 0, errors, player };
}

// What the change does to the sheet. action: 'remove' (new player replaces them), 'sub' (they move
// to a sub slot, new player takes theirs) or 'open' (new player goes into an empty slot).
// Returns { target, action, subSlot, subsFull, summary, warning }.
export function planRosterChange(team, targetLabel, action, newAlias = 'the new player') {
  const slots = rosterSlots(team);
  const target = slots.find((slot) => slot.label.toLowerCase() === String(targetLabel || '').toLowerCase()) || null;
  if (!target) return { ok: false, error: 'That roster slot is not on the sheet any more. Run /roster-change again.' };
  const who = (slot) => clean(slot.alias) || clean(slot.fullName);
  if (action === 'open') {
    if (slotTaken(target)) return { ok: false, error: `${target.label} is not empty any more.` };
    return { ok: true, target, action, subSlot: null, subsFull: false, summary: `Adding **${newAlias}** in the open ${target.label} slot.`, warning: null };
  }
  if (!slotTaken(target)) return { ok: false, error: `${target.label} is empty, so there is nobody to remove or move.` };
  if (action === 'remove') {
    return { ok: true, target, action, subSlot: null, subsFull: false, summary: `Adding **${newAlias}** as ${target.label}, removing **${who(target)}** from the team.`, warning: null };
  }
  if (action === 'sub') {
    if (!isStarterSlot(target.label)) return { ok: false, error: `${who(target)} is already a sub.` };
    const subSlot = slots.find((slot) => isSubSlot(slot.label) && !slotTaken(slot)) || null;
    return {
      ok: true,
      target,
      action,
      subSlot,
      subsFull: !subSlot,
      summary: `Adding **${newAlias}** as ${target.label}, moving **${who(target)}** to ${subSlot ? subSlot.label : 'sub'}.`,
      warning: subSlot ? null : `Both sub slots are full. It will still be sent, but the sheet won't be changed: an admin will decide where ${who(target)} and ${newAlias} go.`
    };
  }
  return { ok: false, error: 'Pick Remove from team or Move to sub.' };
}

// The line added to the sheet's CHANGES column, in the style staff already use there:
// CLUB 333: -"calamity" +"zoro-"
export function changeLogLine(teamName, plan, player) {
  const out = clean(plan.target?.alias) || clean(plan.target?.fullName);
  if (plan.action === 'remove') return `${teamName}: -"${out}" +"${player.alias}"`;
  if (plan.action === 'sub') return `${teamName}: +"${player.alias}" ("${out}" to sub)`;
  return `${teamName}: +"${player.alias}"`;
}

// The new player's details, one per line, for the confirm view and the admin post.
export function playerLines(player) {
  return [
    `**IGN:** ${player.alias}`,
    `**Full name:** ${player.fullName}`,
    `**Nationality:** ${player.nationality}`,
    `**FACEIT:** ${player.faceit}`,
    `**HLTV:** ${player.hltv}`,
    `**SteamID64:** ${player.steamId}`,
    player.twitter ? `**Twitter:** ${player.twitter}` : null,
    `**Discord:** ${player.discordId ? `<@${player.discordId}>` : player.discord}${player.discordId && player.discord && player.discord !== player.discordId ? ` (${player.discord})` : ''}`
  ].filter(Boolean);
}

// The post in the roster change channel. sheetUpdated=false when subs were full (nothing written).
export function buildRosterChangePost({ teamName, group = null, requesterId, player, plan, sheetUpdated = true, nowMs = Date.now() }) {
  const out = clean(plan.target?.alias) || clean(plan.target?.fullName);
  const change = plan.action === 'remove'
    ? `Removed: **${out}** (was ${plan.target.label})`
    : plan.action === 'sub'
      ? `Moved to sub: **${out}** (was ${plan.target.label}${plan.subSlot ? `, now ${plan.subSlot.label}` : ''})`
      : `Nobody removed (added in the open ${plan.target.label} slot)`;
  const description = [
    'Please update this roster on FACEIT.',
    sheetUpdated ? null : `\n⚠️ Both sub slots are full, so the sheet was **not** changed. Decide where **${out}** and **${player.alias}** go, then update the sheet and FACEIT.`
  ].filter(Boolean).join('\n');
  return {
    title: `🔁 Roster change · ${teamName}`.slice(0, 256),
    description,
    fields: [
      { name: 'Team', value: teamName, inline: true },
      { name: 'Group', value: group || 'Unknown', inline: true },
      { name: 'Requested by', value: `<@${requesterId}>`, inline: true },
      { name: `Player added (${plan.target.label})`, value: playerLines(player).join('\n').slice(0, 1024) },
      { name: plan.action === 'open' ? 'Player removed' : plan.action === 'sub' ? 'Player moved to sub' : 'Player removed', value: change.slice(0, 1024) },
      { name: 'Submitted', value: `<t:${Math.floor(nowMs / 1000)}:f>`, inline: true },
      { name: 'Sheet', value: sheetUpdated ? 'Updated' : 'Not changed (subs full)', inline: true }
    ]
  };
}

// The FACEIT team ID in a team link ("…/team-home/<id>/…" or "…/teams/<id>…").
export function faceitTeamIdFromUrl(url) {
  return String(url || '').match(/(?:team-home|teams)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1]?.toLowerCase() || null;
}
