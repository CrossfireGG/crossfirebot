// Roster changes (Roster Change tickets): a captain changes their team on the "Roster Tracking"
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

// A roster change as sheet steps. change: { kind, slotLabel, swapLabel, player }
//   kind 'add'     -> player joins in the first empty slot of change.joinAs ('starter' | 'sub')
//   kind 'remove'  -> slotLabel's player leaves; player (optional) takes their slot
//   kind 'sub'     -> slotLabel's starter moves to the first empty sub slot; player (optional) takes
//                     their starter slot. Both subs full: still sent, sheet left for an admin.
//   kind 'promote' -> slotLabel's sub moves to the first empty starter slot (player optional takes
//                     the sub slot), or swaps with swapLabel's starter when no starter slot is free.
// Returns { ok, error, needsSwap, ops, expect, summary, logLine, warning, sheetChange }.
// ops: { op: 'write', row, player } | { op: 'clear', row } | { op: 'copy', from, to } | { op: 'swap', a, b }
// expect: [{ row, alias }] — every row the change reads; the sheet refuses if any moved.
export function planRosterOps(team, change = {}) {
  const slots = rosterSlots(team);
  const find = (label) => slots.find((slot) => slot.label.toLowerCase() === String(label || '').toLowerCase()) || null;
  const firstEmpty = (kind) => slots.find((slot) => (kind === 'starter' ? isStarterSlot(slot.label) : isSubSlot(slot.label)) && !slotTaken(slot)) || null;
  const who = (slot) => clean(slot.alias) || clean(slot.fullName);
  const expect = (...rows) => rows.filter(Boolean).map((slot) => ({ row: slot.row, alias: slot.alias || '' }));
  const player = change.player || null;
  const teamName = team?.teamName || 'Team';

  if (change.kind === 'add') {
    const kind = change.joinAs === 'sub' ? 'sub' : 'starter';
    const target = firstEmpty(kind);
    if (!player) return { ok: false, error: 'Fill in the new player first.' };
    if (!target) return { ok: false, error: `There's no open ${kind} slot. Pick a player to remove, move to sub or promote first.` };
    return {
      ok: true,
      ops: [{ op: 'write', row: target.row, player }],
      expect: expect(target),
      summary: `Adding **${player.alias}** as ${target.label}.`,
      logLine: `${teamName}: +"${player.alias}"`,
      warning: null,
      sheetChange: true,
      newSlotLabel: target.label
    };
  }

  const slot = find(change.slotLabel);
  if (!slot || !slotTaken(slot)) return { ok: false, error: 'That player is not on the sheet any more. Pick again.' };
  const out = who(slot);
  const replacement = player ? `, adding **${player.alias}** as ${slot.label}` : '';
  const replacementLog = player ? ` +"${player.alias}"` : '';

  if (change.kind === 'remove') {
    return {
      ok: true,
      ops: [player ? { op: 'write', row: slot.row, player } : { op: 'clear', row: slot.row }],
      expect: expect(slot),
      summary: `Removing **${out}** (${slot.label})${replacement}.`,
      logLine: `${teamName}: -"${out}"${replacementLog}`,
      warning: null,
      sheetChange: true,
      newSlotLabel: player ? slot.label : null
    };
  }

  if (change.kind === 'sub') {
    if (!isStarterSlot(slot.label)) return { ok: false, error: `${out} is already a sub.` };
    const sub = firstEmpty('sub');
    if (!sub) {
      return {
        ok: true,
        ops: [],
        expect: [],
        summary: `Moving **${out}** to sub${replacement}.`,
        logLine: null,
        warning: `Both sub slots are full. It will still be sent, but the sheet won't be changed: an admin will decide where ${out}${player ? ` and ${player.alias}` : ''} go.`,
        sheetChange: false,
        newSlotLabel: null
      };
    }
    return {
      ok: true,
      ops: [{ op: 'copy', from: slot.row, to: sub.row }, player ? { op: 'write', row: slot.row, player } : { op: 'clear', row: slot.row }],
      expect: expect(slot, sub),
      summary: `Moving **${out}** to ${sub.label}${replacement}.`,
      logLine: `${teamName}: "${out}" to sub${replacementLog}`,
      warning: null,
      sheetChange: true,
      newSlotLabel: player ? slot.label : null
    };
  }

  if (change.kind === 'promote') {
    if (!isSubSlot(slot.label)) return { ok: false, error: `${out} is already a starter.` };
    const starter = firstEmpty('starter');
    if (starter) {
      const subReplacement = player ? `, adding **${player.alias}** as ${slot.label}` : '';
      return {
        ok: true,
        ops: [{ op: 'copy', from: slot.row, to: starter.row }, player ? { op: 'write', row: slot.row, player } : { op: 'clear', row: slot.row }],
        expect: expect(slot, starter),
        summary: `Promoting **${out}** to ${starter.label}${subReplacement}.`,
        logLine: `${teamName}: "${out}" to starter${replacementLog}`,
        warning: null,
        sheetChange: true,
        newSlotLabel: player ? slot.label : null
      };
    }
    const swap = find(change.swapLabel);
    if (!swap || !isStarterSlot(swap.label) || !slotTaken(swap)) {
      return { ok: false, needsSwap: true, error: 'All five starter slots are full. Pick the starter who moves to sub.' };
    }
    return {
      ok: true,
      ops: [{ op: 'swap', a: slot.row, b: swap.row }],
      expect: expect(slot, swap),
      summary: `Promoting **${out}** to ${swap.label}, moving **${who(swap)}** to ${slot.label}.`,
      logLine: `${teamName}: "${out}" to starter, "${who(swap)}" to sub`,
      warning: player ? `${player.alias} wasn't added: a swap doesn't free a slot. Add them as a separate change.` : null,
      sheetChange: true,
      newSlotLabel: null
    };
  }

  return { ok: false, error: 'Pick what happens to the player.' };
}

// The post in the roster change channel (and the ticket): team, group, who asked, the change, the
// new player, a link to the ticket. sheetChange=false when nothing could be written (subs full).
export function buildRosterChangePost({ teamName, group = null, requesterId, plan, player = null, ticketChannelId = null, roles = [], nowMs = Date.now() }) {
  const description = [
    'Please update this roster on FACEIT.',
    plan.sheetChange ? null : `\n⚠️ ${plan.warning || 'The sheet was not changed.'}`
  ].filter(Boolean).join('\n');
  const fields = [
    { name: 'Team', value: teamName, inline: true },
    { name: 'Group', value: group || 'Unknown', inline: true },
    { name: 'Requested by', value: `<@${requesterId}>`, inline: true },
    { name: 'Change', value: plan.summary.slice(0, 1024) }
  ];
  if (player) fields.push({ name: `Player added${plan.newSlotLabel ? ` (${plan.newSlotLabel})` : ''}`, value: playerLines(player).join('\n').slice(0, 1024) });
  if (roles.length) fields.push({ name: 'Discord roles', value: roles.join('\n').slice(0, 1024) });
  if (ticketChannelId) fields.push({ name: 'Ticket', value: `<#${ticketChannelId}>`, inline: true });
  fields.push({ name: 'Submitted', value: `<t:${Math.floor(nowMs / 1000)}:f>`, inline: true });
  fields.push({ name: 'Sheet', value: plan.sheetChange ? 'Updated' : 'Not changed (admin to decide)', inline: true });
  return { title: `🔁 Roster change · ${teamName}`.slice(0, 256), description, fields };
}

// The account nickname in a FACEIT profile link: faceit.com/en/players/<nickname>[/...].
export function faceitNicknameFromUrl(url) {
  const match = String(url || '').trim().match(/faceit\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?players(?:-modal)?\/([^/?#\s]+)/i);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

// "us" -> "United States".
export function countryName(code) {
  const text = String(code || '').trim();
  if (!text) return '';
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(text.toUpperCase()) || text.toUpperCase();
  } catch {
    return text.toUpperCase();
  }
}

// What FACEIT knows about a player, for the new-player form: { alias, steamId, nationality, faceit }.
// steamId is '' when their Steam account isn't linked on FACEIT.
export function playerFromFaceit(apiPlayer) {
  const nickname = String(apiPlayer?.nickname || '').trim();
  if (!nickname) return null;
  const steamId = [apiPlayer.steam_id_64, apiPlayer.games?.cs2?.game_player_id, apiPlayer.games?.csgo?.game_player_id]
    .map((value) => String(value || ''))
    .find((value) => /^7656119\d{10}$/.test(value)) || '';
  return {
    alias: nickname,
    steamId,
    nationality: countryName(apiPlayer.country),
    faceit: `https://www.faceit.com/en/players/${encodeURIComponent(nickname)}`
  };
}

// The FACEIT team ID in a team link ("…/team-home/<id>/…" or "…/teams/<id>…").
export function faceitTeamIdFromUrl(url) {
  return String(url || '').match(/(?:team-home|teams)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1]?.toLowerCase() || null;
}
