// The playoff map veto in Discord: the veto message and its buttons in the match room, the turn
// clock and pings, the staff controls (pause, resume, undo, reset, choosing for a team, stand-in
// captains, the map pool), the reminders before a match and starting each veto on time.
// The rules and the text of the message are in src/vetoEngine.js.
//
// createVetoBot({ client, config, faceit, deps }) returns what src/index.js calls:
//   handleAdmin(interaction)        /cf veto
//   handleChoice(interaction, kind) a team button: first | server | map | side
//   handleStaffChoice(interaction)  staff confirmed "choose for <team>"
//   handleStaffButton(interaction)  Staff: Pause / Resume / Undo / Reset
//   formatStatus(veto)              the text /crossfire veto and /cf veto inspect show
//   tick(now)                       once a minute: timers, reminders, starting vetoes
// deps are the match-room helpers that still live in src/index.js.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

import { derivePlayoffSeedMap } from './playoffSeeds.js';
import { appendAuditLog, getStoredMatch, getVeto, listSchedules, listTeamMappings, listVetoes, saveVeto, saveVetoSettings } from './store.js';
import {
  applyServerBan,
  applyVetoAction,
  chooseFirstAction,
  chooseSide,
  createVeto,
  expectedVetoAction,
  markTurnTimedOut,
  parseMapPool,
  pauseVeto,
  resumeVeto,
  turnLengthText,
  undoVeto,
  vetoActionLines,
  vetoCanUndo,
  vetoFinalLines,
  vetoInProgress,
  vetoServerLines,
  vetoTurnAction,
  vetoTurnExpired,
  vetoTurnText
} from './vetoEngine.js';

export function createVetoBot({ client, config, faceit, deps }) {
  const {
    EMBED_COLORS,
    canUseBotAdminCommand,
    discordTimestamp,
    getAdminAllowedMentions,
    getStaffMentions,
    getStoredMatchForChannel,
    isPlayoffMatch,
    normalizeConfiguredMatch,
    normalizeRoundCategory,
    normalizeTeamKey,
    teamMappingScope,
    truncateDiscordMessage,
    upsertMatchIntroMessage
  } = deps;
  // Seeds worked out from the FACEIT playoff bracket, per source.
  const playoffSeedCache = new Map();

  async function handleAdminVeto(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const action = interaction.options.getString('action', true);
    // The map pool is for every veto, so it needs no match room.
    if (action === 'maps') {
      const text = interaction.options.getString('maps');
      if (!text) {
        await interaction.editReply(config.vetoMapPool.length
          ? `Veto map pool: **${config.vetoMapPool.join(', ')}**. To change it: \`/cf veto action:maps maps:<seven maps>\`.`
          : 'No veto map pool is set. Set it with `/cf veto action:maps maps:<seven maps>`.');
        return;
      }
      let mapPool;
      try {
        mapPool = parseMapPool(text);
      } catch (error) {
        await interaction.editReply(error.message);
        return;
      }
      await saveVetoSettings({ mapPool, mapPoolSetBy: interaction.user.id, mapPoolSetAt: new Date().toISOString() });
      config.vetoMapPool = mapPool;
      await appendAuditLog({ type: 'veto_map_pool_set', actorId: interaction.user.id, mapPool }).catch(() => null);
      await interaction.editReply(`Veto map pool set: **${mapPool.join(', ')}**. Vetoes started from now on use it; a veto already running keeps the pool it started with.`);
      return;
    }
    const channel = interaction.options.getChannel('match_room') || interaction.channel;
    const stored = channel?.id ? await getStoredMatchForChannel(channel) : null;
    if (!stored) {
      await interaction.editReply('Select or run this inside a linked match room.');
      return;
    }

    if (action === 'inspect') {
      const veto = await getVeto(stored.match.id);
      await interaction.editReply(veto ? formatVetoStatus(veto) : 'No veto exists for this match.');
      return;
    }
    if (action === 'cancel') {
      const existing = await getVeto(stored.match.id);
      const saved = await saveVeto({ ...(existing || { matchId: stored.match.id }), status: 'canceled', pausedAt: null, canceledBy: interaction.user.id, canceledAt: new Date().toISOString() }, existing?.version ?? null);
      await afterVetoChange(saved, stored);
      await retireVetoMessage(existing);
      await appendAuditLog({ type: 'veto_cancel', matchId: stored.match.id, actorId: interaction.user.id });
      await interaction.editReply('Veto canceled. Automatic recovery will not restart it unless an admin resets it.');
      return;
    }
    if (action === 'seeds') {
      const teamASeed = interaction.options.getInteger('team_a_seed');
      const teamBSeed = interaction.options.getInteger('team_b_seed');
      const advantageTeam = interaction.options.getString('advantage_team');
      if (!teamASeed || !teamBSeed || teamASeed === teamBSeed) {
        await interaction.editReply('Provide two different positive seeds. Lower number means higher seed.');
        return;
      }
      const existing = await getVeto(stored.match.id);
      await saveVeto({
        ...(existing || {}),
        matchId: stored.match.id,
        teamA: stored.match.teamA,
        teamB: stored.match.teamB,
        teamASeed,
        teamBSeed,
        advantageTeam: advantageTeam || existing?.advantageTeam || null,
        seedSource: 'admin override',
        status: existing?.status || 'configured',
        seedConfiguredBy: interaction.user.id,
        seedConfiguredAt: new Date().toISOString()
      }, existing?.version ?? null);
      await appendAuditLog({ type: 'veto_seed_override', matchId: stored.match.id, actorId: interaction.user.id, teamASeed, teamBSeed });
      await interaction.editReply(`Persistent seed override saved: ${stored.match.teamA} #${teamASeed}, ${stored.match.teamB} #${teamBSeed}.${advantageTeam ? ` Grand Final advantage: ${advantageTeam === 'teamA' ? stored.match.teamA : stored.match.teamB}.` : ''}`);
      return;
    }

    if (action === 'undo') {
      try {
        const veto = await getVeto(stored.match.id);
        const saved = await undoVetoStep(veto, stored, interaction.user.id);
        await refreshVetoMessage(saved, stored);
        await afterVetoStep(saved, stored, veto);
        await interaction.editReply(`Took back the last step. ${vetoTurnAction(saved)}`);
      } catch (error) {
        await interaction.editReply(error.message);
      }
      return;
    }
    if (action === 'standin') {
      // A stand-in acts like the captain for this match only; the team mapping is not touched.
      const member = interaction.options.getMember('user');
      const veto = await getVeto(stored.match.id);
      if (!member) {
        const list = Object.entries(veto?.standIns || {}).map(([userId, team]) => `<@${userId}> for ${team === 'teamA' ? stored.match.teamA : stored.match.teamB}`);
        await interaction.editReply({ content: list.length ? `Stand-in captains for this match: ${list.join(', ')}. Run it again with \`user:\` to add or remove one.` : 'No stand-in captains for this match. Add one with `/cf veto action:standin user:@player`.', allowedMentions: { parse: [] } });
        return;
      }
      const team = await getVetoActorTeam(member, stored);
      const standIns = { ...(veto?.standIns || {}) };
      const removing = Boolean(standIns[member.id]);
      if (!removing && !team) {
        await interaction.editReply({ content: `<@${member.id}> has neither team's role in this match, so they can't be a stand-in. Give them the team role first, or make the choices for the team yourself with the veto buttons.`, allowedMentions: { parse: [] } });
        return;
      }
      if (!removing && !(veto?.captainOnly ?? config.vetoCaptainOnly)) {
        await interaction.editReply({ content: `Anyone with a team's role can already make the veto choices in this match, so <@${member.id}> doesn't need to be a stand-in.`, allowedMentions: { parse: [] } });
        return;
      }
      if (removing) delete standIns[member.id];
      else standIns[member.id] = team;
      const saved = await saveVeto({
        ...(veto || {}),
        matchId: stored.match.id,
        teamA: stored.match.teamA,
        teamB: stored.match.teamB,
        status: veto?.status || 'configured',
        standIns
      }, veto?.version ?? null);
      await appendAuditLog({ type: removing ? 'veto_standin_removed' : 'veto_standin_added', matchId: stored.match.id, actorId: interaction.user.id, userId: member.id, team }).catch(() => null);
      if (vetoInProgress(saved)) await refreshVetoMessage(saved, stored);
      await interaction.editReply({
        content: removing
          ? `<@${member.id}> is no longer a stand-in captain for this match.`
          : `<@${member.id}> can now make the veto choices for **${team === 'teamA' ? stored.match.teamA : stored.match.teamB}** in this match (the captain still can too).`,
        allowedMentions: { parse: [] }
      });
      return;
    }

    const existing = await getVeto(stored.match.id);
    // "start" on a paused veto carries it on; it does not start it over.
    const resume = action === 'resume' || (action === 'start' && vetoInProgress(existing) && existing.pausedAt);
    if (action === 'pause' || resume) {
      try {
        const saved = await setVetoPaused(existing, action === 'pause', interaction.user.id);
        await refreshVetoMessage(saved, stored);
        await afterVetoChange(saved, stored);
        await interaction.editReply(action === 'pause'
          ? 'Veto paused. The clock is stopped and nobody can choose until it is resumed (`/cf veto action:resume` or the Resume button).'
          : `Veto resumed. ${vetoTurnAction(saved)} They have the full ${turnLengthText(saved)} again.`);
      } catch (error) {
        await interaction.editReply(error.message);
      }
      return;
    }
    if (action === 'reset') {
      await resetVeto(stored, channel, interaction.user.id);
      await interaction.editReply(`Veto reset and started again in <#${channel.id}>.`);
      return;
    }
    await startVetoForStoredMatch(stored, channel, interaction.user.id, true);
    await interaction.editReply(`Veto started in <#${channel.id}>.`);
  }

  // Everything createVeto needs for this match. Throws (with the reason) when seeds, the map pool
  // or the Grand Final advantage team are missing.
  async function buildVetoForStoredMatch(stored, existing) {
    const format = normalizeRoundCategory(stored.match.round).includes('grand final') ? 'bo5_advantage' : 'bo3';
    const configuredAdvantage = normalizeTeamKey(config.vetoAdvantageTeam || '');
    const configuredAdvantageTeam = configuredAdvantage && configuredAdvantage === normalizeTeamKey(stored.match.teamA)
      ? 'teamA'
      : configuredAdvantage && configuredAdvantage === normalizeTeamKey(stored.match.teamB)
        ? 'teamB'
        : null;
    const configuredTeamASeed = config.vetoSeeds.get(normalizeTeamKey(stored.match.teamA));
    const configuredTeamBSeed = config.vetoSeeds.get(normalizeTeamKey(stored.match.teamB));
    const needsAutomaticSeeds = !(existing?.teamASeed || configuredTeamASeed) ||
      !(existing?.teamBSeed || configuredTeamBSeed);
    const automaticSeeds = needsAutomaticSeeds
      ? await getAutomaticPlayoffSeeds(stored.match)
      : null;
    const seeds = {
      teamA: existing?.teamASeed || configuredTeamASeed || automaticSeeds?.teamA,
      teamB: existing?.teamBSeed || configuredTeamBSeed || automaticSeeds?.teamB,
      source: existing?.seedSource ||
        (configuredTeamASeed && configuredTeamBSeed ? 'configured tournament seed table' : automaticSeeds?.source)
    };
    const veto = createVeto({
      match: stored.match,
      mapPool: config.vetoMapPool,
      seeds,
      format,
      advantageTeam: existing?.advantageTeam || configuredAdvantageTeam,
      captainOnly: config.vetoCaptainOnly,
      sidePolicy: config.vetoSidePolicy || undefined,
      turnSeconds: config.vetoTurnSeconds
    });
    return { veto, format, seeds };
  }

  function vetoTeamRoleIds(stored) {
    return [stored.discord?.teamARoleId, stored.discord?.teamBRoleId].filter(Boolean);
  }

  async function startVetoForStoredMatch(stored, channel, actorId = null, force = false) {
    if (!isPlayoffMatch(stored.match)) throw new Error('Automatic vetoes are only enabled for explicitly configured playoff sources.');
    const existing = await getVeto(stored.match.id);
    if (!force && existing && ['choosing_first_action', 'active', 'complete', 'canceled'].includes(existing.status)) return existing;
    const { veto, format, seeds } = await buildVetoForStoredMatch(stored, existing);
    const saved = await saveVeto({ ...veto, channelId: channel.id, startedBy: actorId, startedAt: new Date().toISOString() }, existing?.version ?? null);
    const roleIds = vetoTeamRoleIds(stored);
    const message = await channel.send({
      ...vetoMessagePayload(saved, stored),
      content: `${roleIds.map((id) => `<@&${id}>`).join(' ')} 🗺️ **The map veto is starting.** Each turn has ${turnLengthText(saved)}.${saved.captainOnly ? ' Team captains make the choices.' : ''}`.trim(),
      allowedMentions: { parse: [], roles: roleIds }
    });
    const updated = await saveVeto({ ...saved, messageId: message.id }, saved.version);
    // The message was built before the last save, so its buttons carry the old version.
    await message.edit(vetoMessagePayload(updated, stored)).catch(() => null);
    await appendAuditLog({ type: 'veto_start', matchId: stored.match.id, actorId, format, seedSource: seeds.source });
    await afterVetoChange(updated, stored);
    return updated;
  }

  async function getAutomaticPlayoffSeeds(match) {
    const sourceId = match?.source?.id;
    const source = config.faceitSources.find((entry) => entry.id === sourceId);
    if (!source) return null;

    if (!playoffSeedCache.has(sourceId)) {
      playoffSeedCache.set(sourceId, faceit.getMatchesForSource(source)
        .then((matches) => derivePlayoffSeedMap(matches.map(normalizeConfiguredMatch)))
        .catch((error) => {
          playoffSeedCache.delete(sourceId);
          throw error;
        }));
    }

    const seedMap = await playoffSeedCache.get(sourceId);
    const teamA = seedMap.get(normalizeTeamKey(match.teamA));
    const teamB = seedMap.get(normalizeTeamKey(match.teamB));
    if (!teamA || !teamB || teamA === teamB) return null;
    return { teamA, teamB, source: 'FACEIT playoff bracket seeding' };
  }

  // Staff: throw away what was chosen and start the veto again in this channel.
  async function resetVeto(stored, channel, actorId) {
    const existing = await getVeto(stored.match.id);
    if (existing) {
      await saveVeto({ ...existing, status: 'reset', pausedAt: null, resetBy: actorId }, existing.version);
      await retireVetoMessage(existing);
    }
    await appendAuditLog({ type: 'veto_reset', matchId: stored.match.id, actorId }).catch(() => null);
    const started = await startVetoForStoredMatch(stored, channel, actorId, true);
    if (existing?.server) await refreshMatchIntro(stored);
    return started;
  }

  // Takes the buttons off an old veto message (after a reset or cancel).
  async function retireVetoMessage(veto) {
    if (!veto?.channelId || !veto?.messageId) return;
    const channel = await client.channels.fetch(veto.channelId).catch(() => null);
    const message = channel?.isTextBased?.() ? await channel.messages.fetch(veto.messageId).catch(() => null) : null;
    await message?.edit({ components: [] }).catch(() => null);
  }

  // Redraws the veto message from the stored veto (after a pause, resume or timeout made outside
  // a button click on it).
  async function refreshVetoMessage(veto, stored) {
    if (!veto?.channelId || !veto?.messageId) return;
    const channel = await client.channels.fetch(veto.channelId).catch(() => null);
    const message = channel?.isTextBased?.() ? await channel.messages.fetch(veto.messageId).catch(() => null) : null;
    await message?.edit(vetoMessagePayload(veto, stored)).catch(() => null);
  }

  async function setVetoPaused(veto, paused, actorId) {
    if (!veto) throw new Error('No veto exists for this match.');
    const next = paused ? pauseVeto(veto) : resumeVeto(veto);
    const saved = await saveVeto({ ...next, [paused ? 'pausedBy' : 'resumedBy']: actorId }, veto.version);
    await appendAuditLog({ type: paused ? 'veto_pause' : 'veto_resume', matchId: veto.matchId, actorId }).catch(() => null);
    return saved;
  }

  // ---------- the turn clock: one timer per veto, and a ping for the team whose turn it is ----------

  const vetoTimers = new Map(); // matchId -> timeout
  // matchId -> { message, stepLine, actionCount }: the "you're up" ping (replaced each turn).
  const vetoTurnPings = new Map();
  // matchId -> [{ message, actionCount }]: the "Alpha banned Nuke." lines left in the match room.
  // actionCount is how many bans/picks there were once that step was made.
  const vetoStepMessages = new Map();

  function clearVetoTimer(matchId) {
    const timer = vetoTimers.get(matchId);
    if (timer) clearTimeout(timer);
    vetoTimers.delete(matchId);
  }

  function armVetoTimer(veto) {
    clearVetoTimer(veto.matchId);
    if (!vetoInProgress(veto) || veto.pausedAt || veto.turnTimedOutAt) return;
    const deadline = Date.parse(veto.turnDeadlineAt || '');
    if (!Number.isFinite(deadline)) return;
    const timer = setTimeout(() => {
      handleVetoTurnTimeout(veto.matchId).catch((error) => console.error('Veto turn timeout failed:', error));
    }, Math.max(0, deadline - Date.now()) + 500);
    timer.unref?.();
    vetoTimers.set(veto.matchId, timer);
  }

  // After a restart the timers are gone: put them back (called from the operations tick).
  async function recoverVetoTimers() {
    for (const veto of await listVetoes()) {
      if (vetoInProgress(veto) && !vetoTimers.has(veto.matchId)) armVetoTimer(veto);
    }
  }

  // "Alpha banned Nuke." / "Alpha picked Mirage." for the map ban or pick that turned `before` into
  // `saved`; null for anything else (side choice, undo, pause...).
  function vetoStepLine(before, saved) {
    const actions = saved?.actions || [];
    if (!before || actions.length <= (before.actions || []).length) return null;
    const added = actions[actions.length - 1];
    return `${added.team === 'teamA' ? saved.teamA : saved.teamB} ${added.action === 'ban' ? 'banned' : 'picked'} ${added.map}.`;
  }

  // Call after every change to a veto: restarts the clock's timer and pings whoever is up now.
  // stepLine (the ban or pick just made) goes above the ping. When the next ping goes out, the old
  // one is cut down to its stepLine, so the match room keeps "Alpha banned Nuke.", "Bravo banned
  // Cache." ... and only the newest message pings anyone. When the veto has just finished the
  // stepLine is posted on its own, before the result. Lines for steps staff took back (undo, reset)
  // are deleted.
  async function afterVetoChange(veto, stored, stepLine = null) {
    armVetoTimer(veto);
    const actionCount = (veto.actions || []).length;
    const lines = vetoStepMessages.get(veto.matchId) || [];
    const previous = vetoTurnPings.get(veto.matchId);
    vetoTurnPings.delete(veto.matchId);
    if (previous?.stepLine && previous.actionCount <= actionCount) {
      await previous.message.edit({ content: previous.stepLine, allowedMentions: { parse: [] } }).catch(() => null);
      lines.push({ message: previous.message, actionCount: previous.actionCount });
    } else {
      await previous?.message.delete().catch(() => null);
    }
    const kept = [];
    for (const line of lines) {
      if (line.actionCount <= actionCount) kept.push(line);
      else await line.message.delete().catch(() => null);
    }
    vetoStepMessages.set(veto.matchId, kept);
    if (!veto.channelId) return;
    const turnNext = vetoInProgress(veto) && !veto.pausedAt;
    if (!turnNext && !stepLine) return;
    const channel = await client.channels.fetch(veto.channelId).catch(() => null);
    if (!channel?.isTextBased?.()) return;
    if (!turnNext) {
      const message = await channel.send({ content: stepLine, allowedMentions: { parse: [] } }).catch(() => null);
      if (message) kept.push({ message, actionCount });
      return;
    }
    const roleId = veto.currentTeam === 'teamA' ? stored.discord?.teamARoleId : stored.discord?.teamBRoleId;
    const deadline = Date.parse(veto.turnDeadlineAt || '');
    const message = await channel.send({
      content: `${stepLine ? `${stepLine}\n` : ''}👉 ${roleId ? `<@&${roleId}> ` : ''}${vetoTurnAction(veto)}${Number.isFinite(deadline) ? ` Time runs out <t:${Math.floor(deadline / 1000)}:R>.` : ''}`,
      allowedMentions: { parse: [], roles: roleId ? [roleId] : [] }
    }).catch(() => null);
    if (message) vetoTurnPings.set(veto.matchId, { message, stepLine, actionCount });
  }

  // A turn ran out of time: say so in the match room and tell staff. Nothing is chosen for the
  // team; staff decide what happens (they can pause, resume or reset).
  async function handleVetoTurnTimeout(matchId) {
    vetoTimers.delete(matchId);
    const veto = await getVeto(matchId);
    if (!veto) return;
    if (!vetoTurnExpired(veto)) {
      armVetoTimer(veto);
      return;
    }
    const stored = await getStoredMatch(matchId);
    if (!stored) return;
    let saved;
    try {
      saved = await saveVeto(markTurnTimedOut(veto), veto.version);
    } catch {
      return; // the team chose at the same moment
    }
    await refreshVetoMessage(saved, stored);
    const channel = saved.channelId ? await client.channels.fetch(saved.channelId).catch(() => null) : null;
    const roleId = saved.currentTeam === 'teamA' ? stored.discord?.teamARoleId : stored.discord?.teamBRoleId;
    if (channel?.isTextBased?.()) {
      await channel.send({
        content: `⏰ ${roleId ? `<@&${roleId}> ` : ''}**Time is up** (${turnLengthText(saved)}). ${vetoTurnAction(saved)} Choose now. Staff have been told.`,
        allowedMentions: { parse: [], roles: roleId ? [roleId] : [] }
      }).catch(() => null);
    }
    const staffChannel = config.vetoStaffChannelId ? await client.channels.fetch(config.vetoStaffChannelId).catch(() => null) : null;
    if (staffChannel?.isTextBased?.()) {
      await staffChannel.send({
        content: `${getStaffMentions(staffChannel.guild)} ⏰ **Veto turn timed out** in <#${saved.channelId}>: **${saved.teamA} vs ${saved.teamB}**. ${vetoTurnAction(saved)} Use the staff buttons on the veto message (or \`/cf veto\`) to pause, resume or reset.`,
        allowedMentions: getAdminAllowedMentions(staffChannel.guild)
      }).catch(() => null);
    }
    await appendAuditLog({ type: 'veto_turn_timeout', matchId, team: saved.currentTeam }).catch(() => null);
  }

  // ---------- the team buttons: who acts first, server ban, map ban/pick, side ----------

  // kind: 'first' | 'server' | 'map' | 'side'. value: what the button carries.
  function applyVetoChoice(veto, team, kind, value) {
    if (kind === 'first') return chooseFirstAction(veto, team, value);
    if (kind === 'server') return applyServerBan(veto, team, veto.serverPool?.[Number(value)]);
    if (kind === 'map') return applyVetoAction(veto, team, veto.mapPool[Number(value)]);
    if (kind === 'side') return chooseSide(veto, team, value);
    throw new Error('Unknown veto button.');
  }

  // The same choice in words, for the staff confirmation and the record.
  function vetoChoiceLabel(veto, team, kind, value) {
    const name = (side) => (side === 'teamA' ? veto.teamA : veto.teamB);
    if (kind === 'first') return `${name(value === 'self' ? team : team === 'teamA' ? 'teamB' : 'teamA')} acts first`;
    if (kind === 'server') return `Ban the ${veto.serverPool?.[Number(value)]} server`;
    if (kind === 'map') return `${expectedVetoAction(veto) === 'pick' ? 'Pick' : 'Ban'} ${veto.mapPool[Number(value)]}`;
    return `Start ${value} on ${veto.pendingSide?.map || 'the map'}`;
  }

  // After any step: clock and turn ping, the server in the match info, and the result posts.
  async function afterVetoStep(saved, stored, before) {
    await afterVetoChange(saved, stored, vetoStepLine(before, saved));
    if ((saved.server || null) !== (before?.server || null)) await refreshMatchIntro(stored);
    if (saved.status === 'complete' && before?.status !== 'complete') await announceVetoResult(saved, stored);
  }

  async function handleVetoChoice(interaction, kind) {
    const [, matchId, versionText, value] = interaction.customId.split(':');
    const veto = await getVeto(matchId);
    if (!veto || Number(versionText) !== Number(veto.version)) {
      await interaction.reply({ content: 'That veto button is stale. Use the newest veto message.', ephemeral: true });
      return;
    }
    const stored = await getStoredMatch(matchId);
    const actorTeam = await getVetoActorTeam(interaction.member, stored);
    let refusal = null;
    try {
      await assertVetoActorEligible(interaction.member, stored, veto, actorTeam);
    } catch (error) {
      refusal = error;
    }
    if (refusal) {
      // Staff who can't act as a team member may make the choice for the team whose turn it is,
      // after confirming. Everyone else gets the refusal.
      if (!canUseBotAdminCommand(interaction.member) || !vetoInProgress(veto) || veto.pausedAt) throw refusal;
      const team = veto.currentTeam;
      const teamName = team === 'teamA' ? veto.teamA : veto.teamB;
      await interaction.reply({
        content: `Make this choice **for ${teamName}**?\n**${vetoChoiceLabel(veto, team, kind, value)}**\nOnly do this on the team's word. Your name goes on the veto.`,
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`veto_as:${matchId}:${veto.version}:${kind}:${value}`).setLabel(`Yes, choose for ${teamName}`.slice(0, 80)).setStyle(ButtonStyle.Danger)
        )],
        ephemeral: true
      });
      return;
    }
    const next = applyVetoChoice(veto, actorTeam, kind, value);
    const saved = await saveVeto(next, veto.version);
    await interaction.update(vetoMessagePayload(saved, stored));
    await afterVetoStep(saved, stored, veto);
  }

  // Staff confirmed "choose for <team>": the choice is made for the team whose turn it is and the
  // staff member is named on the veto message and in the audit log.
  async function handleVetoStaffChoice(interaction) {
    const [, matchId, versionText, kind, value] = interaction.customId.split(':');
    if (!canUseBotAdminCommand(interaction.member)) {
      await interaction.reply({ content: 'Only staff can choose for a team.', ephemeral: true });
      return;
    }
    const veto = await getVeto(matchId);
    const stored = await getStoredMatch(matchId);
    if (!veto || !stored || Number(versionText) !== Number(veto.version)) {
      await interaction.update({ content: 'The veto moved on before you confirmed. Use the newest veto message.', components: [] });
      return;
    }
    const team = veto.currentTeam;
    const teamName = team === 'teamA' ? veto.teamA : veto.teamB;
    const label = vetoChoiceLabel(veto, team, kind, value);
    const next = applyVetoChoice(veto, team, kind, value);
    const saved = await saveVeto({
      ...next,
      staffActions: [...(next.staffActions || []), { at: new Date().toISOString(), staffId: interaction.user.id, team, label }]
    }, veto.version);
    await appendAuditLog({ type: 'veto_staff_choice', matchId, actorId: interaction.user.id, team, label }).catch(() => null);
    await interaction.update({ content: `Done for **${teamName}**: ${label}.`, components: [] });
    await refreshVetoMessage(saved, stored);
    await afterVetoStep(saved, stored, veto);
  }

  // Staff: take back the last step.
  async function undoVetoStep(veto, stored, actorId) {
    if (!veto) throw new Error('No veto exists for this match.');
    const saved = await saveVeto({ ...undoVeto(veto), undoneBy: actorId }, veto.version);
    await appendAuditLog({ type: 'veto_undo', matchId: veto.matchId, actorId }).catch(() => null);
    return saved;
  }

  // The match info message shows the server location once the veto has decided it.
  async function refreshMatchIntro(stored) {
    const channel = stored.discord?.channelId ? await client.channels.fetch(stored.discord.channelId).catch(() => null) : null;
    if (!channel?.isTextBased?.()) return;
    await upsertMatchIntroMessage(channel, stored.match).catch((error) => console.error('Match info refresh failed:', error.message));
  }

  // The finished veto: staff channel, both teams in the match room, and (main stream matches)
  // the production crew on the Schedule post. The caster prep pack picks it up by itself.
  async function announceVetoResult(veto, stored) {
    await notifyStaffVetoComplete(veto, stored).catch(() => null);
    const result = vetoFinalLines(veto).join('\n');
    const roleIds = vetoTeamRoleIds(stored);
    const room = veto.channelId ? await client.channels.fetch(veto.channelId).catch(() => null) : null;
    if (room?.isTextBased?.()) {
      await room.send({
        content: `✅ ${roleIds.map((id) => `<@&${id}>`).join(' ')} **Map veto complete**\n${result}`.slice(0, 2000),
        allowedMentions: { parse: [], roles: roleIds }
      }).catch(() => null);
    }
    // Main stream crews get the maps in the match stats (prep) channel, not on the Schedule post.
  }

  // The staff row on the veto message: Pause / Resume, Undo and Reset (reset asks first).
  async function handleVetoStaffButton(interaction) {
    const [, matchId, action] = interaction.customId.split(':');
    if (!canUseBotAdminCommand(interaction.member)) {
      await interaction.reply({ content: 'Only staff can use the staff buttons on the veto.', ephemeral: true });
      return;
    }
    const veto = await getVeto(matchId);
    const stored = await getStoredMatch(matchId);
    if (!veto || !stored) {
      await interaction.reply({ content: 'That veto no longer exists.', ephemeral: true });
      return;
    }
    if (action === 'reset') {
      await interaction.reply({
        content: `Reset the veto for **${veto.teamA} vs ${veto.teamB}**? Everything chosen so far is cleared and the veto starts again.`,
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`veto_staff:${matchId}:resetyes`).setLabel('Yes, reset the veto').setStyle(ButtonStyle.Danger)
        )],
        ephemeral: true
      });
      return;
    }
    if (action === 'resetyes') {
      await interaction.deferUpdate();
      const channel = await client.channels.fetch(veto.channelId || stored.discord?.channelId).catch(() => null);
      if (!channel?.isTextBased?.()) {
        await interaction.editReply({ content: 'The match room for this veto could not be found.', components: [] });
        return;
      }
      await resetVeto(stored, channel, interaction.user.id);
      await interaction.editReply({ content: 'Veto reset. A new veto message is posted.', components: [] });
      return;
    }
    if (action === 'undo') {
      if (!vetoCanUndo(veto)) {
        await interaction.reply({ content: 'There is nothing to undo.', ephemeral: true });
        return;
      }
      const saved = await undoVetoStep(veto, stored, interaction.user.id);
      await interaction.update(vetoMessagePayload(saved, stored));
      await afterVetoStep(saved, stored, veto);
      return;
    }
    if (!vetoInProgress(veto) || Boolean(veto.pausedAt) === (action === 'pause')) {
      await interaction.reply({ content: action === 'pause' ? 'The veto is not running, so there is nothing to pause.' : 'The veto is not paused.', ephemeral: true });
      return;
    }
    const saved = await setVetoPaused(veto, action === 'pause', interaction.user.id);
    await interaction.update(vetoMessagePayload(saved, stored));
    await afterVetoChange(saved, stored);
  }

  async function getVetoActorTeam(member, stored) {
    if (!stored || !member) return null;
    if (stored.discord?.teamARoleId && member.roles.cache.has(stored.discord.teamARoleId)) return 'teamA';
    if (stored.discord?.teamBRoleId && member.roles.cache.has(stored.discord.teamBRoleId)) return 'teamB';
    return null;
  }

  async function assertVetoActorEligible(member, stored, veto, actorTeam) {
    if (!actorTeam) throw new Error('You are not mapped to either team in this match.');
    if (!veto.captainOnly) return;
    // A stand-in staff named for this match acts like the captain.
    if (veto.standIns?.[member.id] === actorTeam) return;
    const mappings = await listTeamMappings(teamMappingScope());
    const teamName = actorTeam === 'teamA' ? stored.match.teamA : stored.match.teamB;
    const mapping = mappings.find((candidate) => [candidate.teamName, ...(candidate.aliases || [])]
      .some((value) => normalizeTeamKey(value) === normalizeTeamKey(teamName)));
    if (!mapping?.captainDiscordIds?.includes(member.id)) throw new Error('Only the mapped captain for your team may act in this veto.');
  }

  function vetoMessagePayload(veto, stored) {
    const actionLines = veto.actions.length ? vetoActionLines(veto).join('\n').slice(0, 1024) : 'No map actions yet.';
    const final = veto.final ? vetoFinalLines(veto).join('\n').slice(0, 1024) : null;
    const embed = new EmbedBuilder()
      .setColor(veto.status === 'complete' ? EMBED_COLORS.accepted : veto.pausedAt ? EMBED_COLORS.warning : EMBED_COLORS.admin)
      .setTitle(veto.status === 'complete' ? 'Discord Veto Complete' : veto.pausedAt ? 'CROSSFIRE Playoff Veto (paused)' : 'CROSSFIRE Playoff Veto')
      .setDescription(`**${veto.teamA} vs ${veto.teamB}**`)
      .addFields(
        { name: 'Map Pool Snapshot', value: veto.mapPool.join(', ') },
        { name: 'Seeds', value: `${veto.teamA}: #${veto.teamASeed}\n${veto.teamB}: #${veto.teamBSeed}\nSource: ${veto.seedSource}` },
        { name: 'Actions', value: actionLines },
        ...(veto.serverPool?.length ? [{ name: `Server Location (${veto.serverPool.join(', ')})`, value: vetoServerLines(veto).join('\n').slice(0, 1024) }] : []),
        final ? { name: 'Final Result', value: final } : { name: 'Current Turn', value: vetoTurnText(veto) },
        { name: 'Side Policy', value: veto.sidePolicy },
        ...(veto.staffActions?.length ? [{ name: 'Chosen by staff', value: veto.staffActions.map((entry) => `<@${entry.staffId}> for **${entry.team === 'teamA' ? veto.teamA : veto.teamB}**: ${entry.label}`).join('\n').slice(0, 1024) }] : []),
        ...(Object.keys(veto.standIns || {}).length ? [{ name: 'Stand-in captains', value: Object.entries(veto.standIns).map(([userId, team]) => `<@${userId}> for **${team === 'teamA' ? veto.teamA : veto.teamB}**`).join('\n').slice(0, 1024) }] : []),
        { name: 'FACEIT', value: stored.match.faceitUrl || 'Not linked' }
      )
      .setFooter({ text: 'Discord veto only. Staff must enter the result into FACEIT.' });
    const components = [];
    if (veto.pausedAt) {
      // Paused: nobody can choose, so only the staff row is shown.
    } else if (veto.status === 'choosing_first_action') {
      components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`veto_first:${veto.matchId}:${veto.version}:self`).setLabel('Our team acts first').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`veto_first:${veto.matchId}:${veto.version}:opponent`).setLabel('Opponent acts first').setStyle(ButtonStyle.Secondary)
      ));
    } else if (expectedVetoAction(veto) === 'server') {
      components.push(new ActionRowBuilder().addComponents(...veto.serverPool
        .map((server, index) => ({ server, index }))
        .filter(({ server }) => veto.availableServers.includes(server))
        .slice(0, 5)
        .map(({ server, index }) => new ButtonBuilder().setCustomId(`veto_server:${veto.matchId}:${veto.version}:${index}`).setLabel(`Ban ${server}`.slice(0, 80)).setStyle(ButtonStyle.Danger))));
    } else if (veto.status === 'active' && veto.pendingSide) {
      // The team that didn't pick the map chooses where it starts.
      components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`veto_side:${veto.matchId}:${veto.version}:CT`).setLabel(`Start CT on ${veto.pendingSide.map}`.slice(0, 80)).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`veto_side:${veto.matchId}:${veto.version}:T`).setLabel(`Start T on ${veto.pendingSide.map}`.slice(0, 80)).setStyle(ButtonStyle.Secondary)
      ));
    } else if (veto.status === 'active') {
      const available = veto.mapPool.map((map, index) => ({ map, index })).filter(({ map }) => veto.availableMaps.includes(map));
      // Red "Ban <map>" buttons on a ban turn, green "Pick <map>" on a pick turn.
      const banning = expectedVetoAction(veto) === 'ban';
      for (let index = 0; index < available.length; index += 5) {
        components.push(new ActionRowBuilder().addComponents(...available.slice(index, index + 5).map(({ map, index: mapIndex }) =>
          new ButtonBuilder().setCustomId(`veto_map:${veto.matchId}:${veto.version}:${mapIndex}`).setLabel(`${banning ? 'Ban' : 'Pick'} ${map}`.slice(0, 80)).setStyle(banning ? ButtonStyle.Danger : ButtonStyle.Success)
        )));
      }
    }
    // Staff only (checked when clicked): stop or restart the clock, take back the last step, or
    // start the veto over. A finished veto keeps Undo, for a wrong last click.
    const staffRow = [];
    if (vetoInProgress(veto)) {
      staffRow.push(veto.pausedAt
        ? new ButtonBuilder().setCustomId(`veto_staff:${veto.matchId}:resume`).setLabel('Staff: Resume').setEmoji('▶️').setStyle(ButtonStyle.Success)
        : new ButtonBuilder().setCustomId(`veto_staff:${veto.matchId}:pause`).setLabel('Staff: Pause').setEmoji('⏸️').setStyle(ButtonStyle.Secondary));
    }
    if (vetoCanUndo(veto)) staffRow.push(new ButtonBuilder().setCustomId(`veto_staff:${veto.matchId}:undo`).setLabel('Staff: Undo last step').setEmoji('↩️').setStyle(ButtonStyle.Secondary));
    if (vetoInProgress(veto)) staffRow.push(new ButtonBuilder().setCustomId(`veto_staff:${veto.matchId}:reset`).setLabel('Staff: Reset').setEmoji('🔄').setStyle(ButtonStyle.Secondary));
    if (staffRow.length) components.push(new ActionRowBuilder().addComponents(...staffRow));
    return { embeds: [embed], components };
  }

  function formatVetoStatus(veto) {
    return truncateDiscordMessage([
      `**${veto.teamA} vs ${veto.teamB}**`,
      `Status: ${veto.status}${veto.pausedAt ? ' (paused)' : ''}`,
      `Format: ${veto.format}`,
      `Map pool: ${(veto.mapPool || []).join(', ')}`,
      vetoInProgress(veto) ? `Turn: ${vetoTurnText(veto)}` : null,
      ...vetoActionLines(veto),
      ...vetoServerLines(veto),
      ...vetoFinalLines(veto)
    ].filter(Boolean).join('\n'));
  }

  async function notifyStaffVetoComplete(veto, stored) {
    const channelId = config.vetoStaffChannelId;
    const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
    if (!channel?.isTextBased?.()) return;
    await channel.send({ embeds: vetoMessagePayload(veto, stored).embeds });
  }

  // The veto can't start (seeds, map pool or Grand Final advantage team missing): say so once.
  async function reportVetoBlocked(stored, channel, existing, reason, scheduledAtIso) {
    if (existing?.status === 'blocked' && existing.reason === reason) return;
    await saveVeto({
      ...(existing || {}),
      matchId: stored.match.id,
      teamA: stored.match.teamA,
      teamB: stored.match.teamB,
      status: 'blocked',
      reason,
      scheduledAtIso: scheduledAtIso || null
    }, existing?.version ?? null);
    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(EMBED_COLORS.warning)
        .setTitle('Veto Needs Staff Configuration')
        .setDescription(reason)
        .setFooter({ text: 'No seed or map-pool values were guessed. Staff can configure them and run /cf veto action:start.' })]
    });
  }

  // Once a minute (the operations tick): timers back after a restart, the reminders before a
  // match, and starting each playoff veto on time.
  async function tick(now = Date.now()) {
    await recoverVetoTimers().catch((error) => console.error('Veto timer recovery failed:', error));
    // Playoff vetoes: teams are pinged VETO_NOTICE_MINUTES (60) before match time that the veto
    // happens in their match room, and the veto starts VETO_START_MINUTES (20) before match time.
    const noticeMs = config.vetoNoticeMinutes * 60 * 1000;
    const startLeadMs = config.vetoStartMinutes * 60 * 1000;
    const schedules = await listSchedules();
    for (const schedule of schedules) {
      if (!schedule.adminApproved) continue;
      const startMs = Date.parse(schedule.scheduledAtIso || schedule.scheduledAt);
      if (!Number.isFinite(startMs) || startMs <= now) continue;
      if (startMs - now > Math.max(noticeMs, startLeadMs)) continue;
      const stored = await getStoredMatch(schedule.matchId);
      if (!stored || !isPlayoffMatch(stored.match)) continue;
      const status = String(stored.match.status || '').toLowerCase();
      if (/(finished|done|completed|cancel)/.test(status)) continue;
      const existing = await getVeto(stored.match.id);
      if (existing && ['choosing_first_action', 'active', 'complete', 'canceled'].includes(existing.status)) continue;
      const channel = stored.discord?.channelId ? await client.channels.fetch(stored.discord.channelId).catch(() => null) : null;
      if (!channel?.isTextBased?.()) continue;
      const scheduledAtIso = new Date(startMs).toISOString();

      if (startMs - now > startLeadMs) {
        const roleIds = vetoTeamRoleIds(stored);
        const vetoAtIso = new Date(startMs - startLeadMs).toISOString();
        const untilVetoMs = startMs - now - startLeadMs;
        const soonMs = config.vetoSoonMinutes * 60 * 1000;
        // The heads-up went out already: both teams get one more ping VETO_SOON_MINUTES (5)
        // before the veto starts. Not when the veto is blocked (it would not start).
        if (existing?.noticeFor === scheduledAtIso) {
          if (soonMs > 0 && untilVetoMs <= soonMs && existing.soonNoticeFor !== scheduledAtIso && existing.status !== 'blocked') {
            const pinged = await channel.send({
              content: `${roleIds.map((id) => `<@&${id}>`).join(' ')} ⏳ **The map veto starts ${discordTimestamp(vetoAtIso, 'R')}** (at ${discordTimestamp(vetoAtIso, 't')}), here in this channel. ${config.vetoCaptainOnly ? 'Captains, be ready.' : 'Have someone from each team ready.'}`.trim(),
              allowedMentions: { parse: [], roles: roleIds }
            }).then(() => true).catch((error) => {
              console.error(`Veto ${config.vetoSoonMinutes}-minute ping for ${stored.match.id} failed:`, error.message);
              return false;
            });
            if (pinged) await saveVeto({ ...existing, soonNoticeFor: scheduledAtIso }, existing.version);
          }
          continue;
        }
        // Not time to start yet: the heads-up, once per scheduled time.
        const sent = await channel.send({
          content: [
            `${roleIds.map((id) => `<@&${id}>`).join(' ')} 📢 **Map veto reminder**`.trim(),
            `Your match is at ${discordTimestamp(scheduledAtIso, 't')}. The map veto (bans, picks and sides) happens **here in this channel**, starting at ${discordTimestamp(vetoAtIso, 't')} (${discordTimestamp(vetoAtIso, 'R')}), ${config.vetoStartMinutes} minutes before match time.`,
            `${config.vetoCaptainOnly ? 'Team captains make the choices, so captains need to be here.' : 'Have someone from each team here.'} Each turn has ${turnLengthText({ turnSeconds: config.vetoTurnSeconds })}.`
          ].join('\n'),
          allowedMentions: { parse: [], roles: roleIds }
        }).then(() => true).catch((error) => {
          console.error(`Veto reminder for ${stored.match.id} failed:`, error.message);
          return false;
        });
        if (!sent) continue;
        const noted = await saveVeto({
          ...(existing || {}),
          matchId: stored.match.id,
          teamA: stored.match.teamA,
          teamB: stored.match.teamB,
          status: existing?.status || 'scheduled',
          noticeFor: scheduledAtIso,
          // A heads-up that goes out this close to the veto (a late approval) covers the short ping too.
          soonNoticeFor: untilVetoMs <= soonMs ? scheduledAtIso : (existing?.soonNoticeFor || null)
        }, existing?.version ?? null);
        // Tell staff now, not at start time, if the veto can't start (no seeds, map pool...).
        try {
          await buildVetoForStoredMatch(stored, noted);
        } catch (error) {
          await reportVetoBlocked(stored, channel, noted, error.message, scheduledAtIso);
        }
        continue;
      }

      try {
        await startVetoForStoredMatch(stored, channel);
      } catch (error) {
        await reportVetoBlocked(stored, channel, existing, error.message, scheduledAtIso);
      }
    }
  }

  return {
    handleAdmin: handleAdminVeto,
    handleChoice: handleVetoChoice,
    handleStaffChoice: handleVetoStaffChoice,
    handleStaffButton: handleVetoStaffButton,
    formatStatus: formatVetoStatus,
    tick
  };
}
