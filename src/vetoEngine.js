const BO3_STEPS = ['ban', 'ban', 'pick', 'pick', 'ban', 'ban'];
const BO5_ADVANTAGE_STEPS = ['ban', 'ban', 'pick', 'pick', 'pick', 'pick'];

export function createVeto({ match, mapPool, seeds, format, advantageTeam = null, captainOnly = true, sidePolicy = 'staff decides' }) {
  validateVetoConfig(mapPool, format);
  const teamASeed = Number(seeds?.teamA);
  const teamBSeed = Number(seeds?.teamB);
  if (!Number.isInteger(teamASeed) || !Number.isInteger(teamBSeed) || teamASeed === teamBSeed) {
    throw new Error('Authoritative seeds are required and must be different before the veto can start.');
  }
  const higherSeedTeam = teamASeed < teamBSeed ? 'teamA' : 'teamB';
  if (format === 'bo5_advantage' && !['teamA', 'teamB'].includes(advantageTeam)) {
    throw new Error('Grand Final upper-bracket advantage team is required before the veto can start.');
  }
  return {
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
    captainOnly,
    sidePolicy,
    messageId: null,
    channelId: null
  };
}

export function chooseFirstAction(veto, actorTeam, choice) {
  if (veto.status !== 'choosing_first_action') throw new Error('The first-action choice is already complete.');
  if (actorTeam !== veto.higherSeedTeam) throw new Error('Only the higher-seeded team may choose who acts first.');
  if (!['self', 'opponent'].includes(choice)) throw new Error('Invalid first-action choice.');
  const firstActionTeam = choice === 'self' ? actorTeam : oppositeTeam(actorTeam);
  return {
    ...veto,
    status: 'active',
    firstActionTeam,
    currentTeam: firstActionTeam
  };
}

export function applyVetoAction(veto, actorTeam, mapName) {
  if (veto.status !== 'active') throw new Error('This veto is not active.');
  if (actorTeam !== veto.currentTeam) throw new Error('It is not your team’s turn.');
  if (!veto.availableMaps.includes(mapName)) throw new Error('That map is no longer available.');
  const action = veto.steps[veto.stepIndex];
  if (!action) throw new Error('There are no remaining veto actions.');

  const next = {
    ...veto,
    availableMaps: veto.availableMaps.filter((map) => map !== mapName),
    actions: [...veto.actions, { index: veto.stepIndex + 1, team: actorTeam, action, map: mapName }],
    stepIndex: veto.stepIndex + 1,
    currentTeam: oppositeTeam(actorTeam)
  };

  if (next.stepIndex >= next.steps.length) {
    if (next.availableMaps.length !== 1) throw new Error('Veto configuration did not leave exactly one map.');
    next.status = 'complete';
    next.completedAt = new Date().toISOString();
    next.currentTeam = null;
    next.final = buildFinalResult(next);
  }
  return next;
}

export function buildFinalResult(veto) {
  const picks = veto.actions.filter((entry) => entry.action === 'pick').map((entry) => entry.map);
  const remaining = veto.availableMaps[0];
  if (veto.format === 'bo5_advantage') {
    return {
      playableMaps: picks,
      awardedMap: remaining,
      startingScore: `1-0 ${veto.advantageTeam === 'teamA' ? veto.teamA : veto.teamB}`
    };
  }
  return { playableMaps: [...picks, remaining], decider: remaining, awardedMap: null, startingScore: '0-0' };
}

export function expectedVetoAction(veto) {
  return veto.status === 'active' ? veto.steps[veto.stepIndex] || null : null;
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
