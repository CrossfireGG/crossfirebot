const BO3_STEPS = ['ban', 'ban', 'pick', 'pick', 'ban', 'ban'];
const BO5_ADVANTAGE_STEPS = ['ban', 'ban', 'pick', 'pick', 'pick', 'pick'];

// Sides: when a team picks a map, the other team chooses the side it starts on. A decider map
// (the one left over in a BO3) has no side choice: a knife round decides.
export const VETO_SIDES = ['CT', 'T'];
export const VETO_SIDE_POLICY = 'When a team picks a map, the other team chooses its starting side. Decider maps: knife round for sides.';
// Every turn (who acts first, a ban, a pick, a side) has this long. When it runs out the team and
// staff are told; nothing is chosen for the team. Staff can pause, resume and reset.
export const VETO_TURN_SECONDS = 120;
const IN_PROGRESS = ['choosing_first_action', 'active'];
// What a step changes. Each step keeps the values from before it, so staff can undo it.
const STEP_KEYS = ['status', 'firstActionTeam', 'currentTeam', 'stepIndex', 'availableMaps', 'actions', 'pendingSide', 'availableServers', 'serverActions', 'server', 'final', 'completedAt', 'staffActions'];

export function createVeto({ match, mapPool, seeds, format, advantageTeam = null, captainOnly = true, sidePolicy = VETO_SIDE_POLICY, turnSeconds = VETO_TURN_SECONDS, serverPool = [], now = Date.now() }) {
  validateVetoConfig(mapPool, format);
  if (new Set(serverPool).size !== serverPool.length) throw new Error('Veto server locations must all be different.');
  const teamASeed = Number(seeds?.teamA);
  const teamBSeed = Number(seeds?.teamB);
  if (!Number.isInteger(teamASeed) || !Number.isInteger(teamBSeed) || teamASeed === teamBSeed) {
    throw new Error('Authoritative seeds are required and must be different before the veto can start.');
  }
  const higherSeedTeam = teamASeed < teamBSeed ? 'teamA' : 'teamB';
  if (format === 'bo5_advantage' && !['teamA', 'teamB'].includes(advantageTeam)) {
    throw new Error('Grand Final upper-bracket advantage team is required before the veto can start.');
  }
  return withTurnClock({
    matchId: match.id,
    status: 'choosing_first_action',
    teamA: match.teamA,
    teamB: match.teamB,
    teamASeed,
    teamBSeed,
    seedSource: seeds.source || 'configured tournament seed table',
    higherSeedTeam,
    advantageTeam: format === 'bo5_advantage' ? advantageTeam : null,
    firstActionTeam: null,
    currentTeam: higherSeedTeam,
    format,
    steps: format === 'bo5_advantage' ? BO5_ADVANTAGE_STEPS : BO3_STEPS,
    stepIndex: 0,
    mapPool: [...mapPool],
    availableMaps: [...mapPool],
    actions: [],
    pendingSide: null,
    // Server location, decided after the maps: the teams ban in turn (the team acting first
    // goes first) until one is left. With no locations, or only one, there is nothing to ban.
    serverPool: [...serverPool],
    availableServers: [...serverPool],
    serverActions: [],
    server: serverPool.length === 1 ? serverPool[0] : null,
    // Choices staff made for a team: [{ at, staffId, team, label }].
    staffActions: [],
    history: [],
    captainOnly,
    sidePolicy,
    turnSeconds,
    pausedAt: null,
    // A restarted veto must not keep the old result (the store merges onto the old record).
    final: null,
    completedAt: null,
    messageId: null,
    channelId: null
  }, now);
}

export function chooseFirstAction(veto, actorTeam, choice, now = Date.now()) {
  if (veto.status !== 'choosing_first_action') throw new Error('The first-action choice is already complete.');
  assertNotPaused(veto);
  if (actorTeam !== veto.higherSeedTeam) throw new Error('Only the higher-seeded team may choose who acts first.');
  if (!['self', 'opponent'].includes(choice)) throw new Error('Invalid first-action choice.');
  const firstActionTeam = choice === 'self' ? actorTeam : oppositeTeam(actorTeam);
  return remember(veto, withTurnClock({
    ...veto,
    status: 'active',
    firstActionTeam,
    currentTeam: firstActionTeam
  }, now));
}

// True while the server location still has to be decided.
function needsServer(veto) {
  return (veto.serverPool?.length || 0) > 1 && !veto.server;
}

// The maps (and the sides on them) are all chosen.
function mapsDone(veto) {
  return !veto.pendingSide && veto.stepIndex >= veto.steps.length;
}

// Server location, after the maps: ban, ban, ... and the one left over is where the match is
// played. The team acting first bans first.
export function applyServerBan(veto, actorTeam, serverName, now = Date.now()) {
  if (veto.status === 'active' && needsServer(veto) && !mapsDone(veto)) throw new Error('The maps are chosen first, then the server location.');
  if (veto.status !== 'active' || !needsServer(veto)) throw new Error('There is no server location to ban right now.');
  assertNotPaused(veto);
  if (actorTeam !== veto.currentTeam) throw new Error('It is not your team’s turn.');
  if (!veto.availableServers.includes(serverName)) throw new Error('That server location is no longer available.');
  const availableServers = veto.availableServers.filter((server) => server !== serverName);
  const decided = availableServers.length === 1;
  const next = {
    ...veto,
    availableServers,
    serverActions: [...(veto.serverActions || []), { index: (veto.serverActions || []).length + 1, team: actorTeam, server: serverName }],
    server: decided ? availableServers[0] : null,
    currentTeam: oppositeTeam(actorTeam)
  };
  // The last server ban ends the veto.
  return remember(veto, decided ? finishIfDone(next, now) : withTurnClock(next, now));
}

export function applyVetoAction(veto, actorTeam, mapName, now = Date.now()) {
  if (veto.status !== 'active') throw new Error('This veto is not active.');
  assertNotPaused(veto);
  if (actorTeam !== veto.currentTeam) throw new Error('It is not your team’s turn.');
  if (veto.pendingSide) throw new Error(`A starting side on ${veto.pendingSide.map} must be chosen first.`);
  if (!veto.availableMaps.includes(mapName)) throw new Error('That map is no longer available.');
  const action = veto.steps[veto.stepIndex];
  if (!action) throw new Error('There are no remaining veto actions.');

  // After a pick the other team chooses its side on that map before the veto goes on. It is
  // that team's turn next either way.
  const next = {
    ...veto,
    availableMaps: veto.availableMaps.filter((map) => map !== mapName),
    actions: [...veto.actions, { index: veto.stepIndex + 1, team: actorTeam, action, map: mapName }],
    stepIndex: veto.stepIndex + 1,
    currentTeam: oppositeTeam(actorTeam),
    pendingSide: action === 'pick' ? { map: mapName, team: oppositeTeam(actorTeam) } : null
  };
  return remember(veto, finishIfDone(next, now));
}

// The team that did not pick the map chooses the side it starts on ('CT' or 'T').
export function chooseSide(veto, actorTeam, side, now = Date.now()) {
  if (veto.status !== 'active' || !veto.pendingSide) throw new Error('There is no side to choose right now.');
  assertNotPaused(veto);
  if (actorTeam !== veto.pendingSide.team) throw new Error('The other team chooses the side on this map.');
  if (!VETO_SIDES.includes(side)) throw new Error('Invalid side.');
  const { map, team } = veto.pendingSide;
  return remember(veto, finishIfDone({
    ...veto,
    actions: veto.actions.map((entry) => (entry.action === 'pick' && entry.map === map ? { ...entry, side, sideTeam: team } : entry)),
    pendingSide: null
  }, now));
}

function finishIfDone(next, now) {
  if (!mapsDone(next)) return withTurnClock(next, now);
  if (next.availableMaps.length !== 1) throw new Error('Veto configuration did not leave exactly one map.');
  // Maps done: the server location is next, starting with the team acting first.
  if (needsServer(next)) return withTurnClock({ ...next, currentTeam: next.firstActionTeam }, now);
  return {
    ...next,
    status: 'complete',
    completedAt: new Date(now).toISOString(),
    currentTeam: null,
    turnDeadlineAt: null,
    turnTimedOutAt: null,
    final: buildFinalResult(next)
  };
}

export function buildFinalResult(veto) {
  const pickActions = veto.actions.filter((entry) => entry.action === 'pick');
  const picks = pickActions.map((entry) => entry.map);
  // Every map to be played, in order: who picked it and who starts where, or the knife round.
  const maps = pickActions.map((entry) => ({ map: entry.map, pickedBy: entry.team, sideTeam: entry.sideTeam || null, side: entry.side || null, knife: false }));
  const remaining = veto.availableMaps[0];
  if (veto.format === 'bo5_advantage') {
    return {
      playableMaps: picks,
      maps,
      awardedMap: remaining,
      startingScore: `1-0 ${veto.advantageTeam === 'teamA' ? veto.teamA : veto.teamB}`
    };
  }
  return {
    playableMaps: [...picks, remaining],
    maps: [...maps, { map: remaining, pickedBy: null, sideTeam: null, side: null, knife: true }],
    decider: remaining,
    awardedMap: null,
    startingScore: '0-0'
  };
}

// 'ban' or 'pick' (a map), 'side' (a starting side on the map just picked), then 'server' (ban a
// server location) once the maps are done, or null.
export function expectedVetoAction(veto) {
  if (veto.status !== 'active') return null;
  if (veto.pendingSide) return 'side';
  if (veto.stepIndex < veto.steps.length) return veto.steps[veto.stepIndex];
  return needsServer(veto) ? 'server' : null;
}

// ---------- undo ----------

function remember(before, after) {
  const snapshot = Object.fromEntries(STEP_KEYS.map((key) => [key, before[key] ?? (key === 'staffActions' ? [] : null)]));
  return { ...after, history: [...(before.history || []), snapshot] };
}

export function vetoCanUndo(veto) {
  return Boolean(veto?.history?.length) && (vetoInProgress(veto) || veto.status === 'complete');
}

// Staff: take back the last step (who acts first, a server ban, a map ban or pick, a side).
// The team whose turn it was gets the full time again; a paused veto stays paused.
export function undoVeto(veto, now = Date.now()) {
  if (!vetoCanUndo(veto)) throw new Error('There is nothing to undo.');
  const history = veto.history.slice(0, -1);
  const restored = { ...veto, ...veto.history[veto.history.length - 1], history, turnTimedOutAt: null };
  return veto.pausedAt ? { ...restored, turnDeadlineAt: null } : withTurnClock(restored, now);
}

// ---------- the turn clock ----------

// A new turn: the clock starts again.
function withTurnClock(veto, now) {
  const seconds = Number(veto.turnSeconds) > 0 ? Number(veto.turnSeconds) : VETO_TURN_SECONDS;
  return { ...veto, turnDeadlineAt: new Date(now + seconds * 1000).toISOString(), turnTimedOutAt: null };
}

function assertNotPaused(veto) {
  if (veto.pausedAt) throw new Error('The veto is paused by staff.');
}

export function vetoInProgress(veto) {
  return Boolean(veto && IN_PROGRESS.includes(veto.status));
}

// Staff: stop the clock. Nobody can act until it is resumed.
export function pauseVeto(veto, now = Date.now()) {
  if (!vetoInProgress(veto)) throw new Error('This veto is not in progress.');
  if (veto.pausedAt) throw new Error('The veto is already paused.');
  return { ...veto, pausedAt: new Date(now).toISOString(), turnDeadlineAt: null, turnTimedOutAt: null };
}

// Staff: carry on. The team whose turn it is gets the full time again.
export function resumeVeto(veto, now = Date.now()) {
  if (!vetoInProgress(veto)) throw new Error('This veto is not in progress.');
  if (!veto.pausedAt) throw new Error('The veto is not paused.');
  return withTurnClock({ ...veto, pausedAt: null }, now);
}

// True once: the turn's time is up and nobody has been told yet.
export function vetoTurnExpired(veto, now = Date.now()) {
  if (!vetoInProgress(veto) || veto.pausedAt || veto.turnTimedOutAt) return false;
  const deadline = Date.parse(veto.turnDeadlineAt || '');
  return Number.isFinite(deadline) && now >= deadline;
}

export function markTurnTimedOut(veto, now = Date.now()) {
  return { ...veto, turnTimedOutAt: new Date(now).toISOString() };
}

// "2 minutes", "90 seconds"
export function turnLengthText(veto) {
  const seconds = Number(veto?.turnSeconds) > 0 ? Number(veto.turnSeconds) : VETO_TURN_SECONDS;
  if (seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? '' : 's'}`;
  return `${seconds} seconds`;
}

export function oppositeSide(side) {
  return side === 'CT' ? 'T' : 'CT';
}

// ---------- the text of the veto message (the bot and tools/veto-sim.js both use these) ----------

function teamName(veto, team) {
  return team === 'teamA' ? veto.teamA : veto.teamB;
}

// "3. **Alpha** pick Mirage (**Bravo** starts CT)"
export function vetoActionLines(veto) {
  return (veto.actions || []).map((entry) => {
    const line = `${entry.index}. **${teamName(veto, entry.team)}** ${entry.action} ${entry.map}`;
    return entry.side ? `${line} (**${teamName(veto, entry.sideTeam)}** starts ${entry.side})` : line;
  });
}

// What the team whose turn it is has to do, without the clock.
export function vetoTurnAction(veto) {
  if (veto.status === 'choosing_first_action') return `${teamName(veto, veto.higherSeedTeam)} chooses who takes the first veto action.`;
  const action = expectedVetoAction(veto);
  if (action === 'server') return `${teamName(veto, veto.currentTeam)}: **ban** a server location.`;
  if (action === 'side') return `${teamName(veto, veto.pendingSide.team)}: choose your **starting side** on **${veto.pendingSide.map}**.`;
  return action ? `${teamName(veto, veto.currentTeam)}: **${action}** a map.` : 'None.';
}

// The same with the clock: a live Discord countdown, "time is up", or "paused".
export function vetoTurnText(veto) {
  const action = vetoTurnAction(veto);
  if (!vetoInProgress(veto)) return action;
  if (veto.pausedAt) return `⏸️ **Paused by staff.** The clock is stopped.\nNext: ${action}`;
  if (veto.turnTimedOutAt) return `${action}\n⏰ **Time is up.** Choose now; staff have been told.`;
  const deadline = Date.parse(veto.turnDeadlineAt || '');
  return Number.isFinite(deadline) ? `${action}\n⏱️ ${turnLengthText(veto)} per turn: time runs out <t:${Math.floor(deadline / 1000)}:R>.` : action;
}

// "1. **Alpha** ban Denver" ... "Server: **Chicago**". Empty when the veto has no server choice.
export function vetoServerLines(veto) {
  if (!veto.serverPool?.length) return [];
  const lines = (veto.serverActions || []).map((entry) => `${entry.index}. **${teamName(veto, entry.team)}** ban ${entry.server}`);
  lines.push(veto.server ? `Server: **${veto.server}**` : `Left: ${(veto.availableServers || []).join(', ')}`);
  return lines;
}

export function vetoFinalLines(veto) {
  const final = veto.final;
  if (!final) return [];
  // Vetoes finished before sides were added have no per-map list.
  const maps = final.maps || (final.playableMaps || []).map((map) => ({ map, knife: map === final.decider }));
  const lines = maps.map((entry, index) => {
    const parts = [`Map ${index + 1}: **${entry.map}**`];
    if (entry.knife) parts.push('decider', '🔪 **knife round** for sides');
    else {
      if (entry.pickedBy) parts.push(`${teamName(veto, entry.pickedBy)} pick`);
      if (entry.side) parts.push(`**${teamName(veto, entry.sideTeam)}** starts ${entry.side}, ${teamName(veto, oppositeTeam(entry.sideTeam))} starts ${oppositeSide(entry.side)}`);
    }
    return parts.join(' · ');
  });
  if (veto.server) lines.push(`Server: **${veto.server}**`);
  if (final.awardedMap) lines.push(`Awarded map (not played): **${final.awardedMap}**`);
  lines.push(`Starting score: **${final.startingScore}**`);
  return lines;
}

// "Dust2 Mirage, Nuke, ..." -> ['Dust2', 'Mirage', 'Nuke', ...]. Throws unless it is exactly
// seven different maps.
export function parseMapPool(text) {
  const maps = String(text || '').split(/[\s,;]+/).map((map) => map.trim()).filter(Boolean);
  if (maps.length !== 7 || new Set(maps.map((map) => map.toLowerCase())).size !== 7) {
    throw new Error(`The map pool must be exactly seven different maps (got ${maps.length}${maps.length ? `: ${maps.join(', ')}` : ''}).`);
  }
  return maps;
}

export function validateVetoConfig(mapPool, format) {
  if (!Array.isArray(mapPool) || mapPool.length !== 7 || new Set(mapPool).size !== 7) {
    throw new Error('Veto map pool must contain exactly seven unique maps.');
  }
  if (!['bo3', 'bo5_advantage'].includes(format)) throw new Error('Unsupported veto format.');
}

export function oppositeTeam(team) {
  return team === 'teamA' ? 'teamB' : 'teamA';
}
