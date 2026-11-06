import fs from 'node:fs/promises';
import path from 'node:path';

import { STREAM_ACTIVE_STATUSES } from './streamRequest.js';

const dbPath = path.resolve(process.env.BOT_DATA_PATH || 'bot-data.json');
let mutationQueue = Promise.resolve();

async function readDb() {
  try {
    return JSON.parse(await fs.readFile(dbPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { matches: {}, schedules: {}, scheduleProposals: {} };
    }
    throw error;
  }
}

function normalizeDb(db) {
  return {
    ...db,
    schemaVersion: 2,
    matches: db.matches || {},
    schedules: db.schedules || {},
    scheduleProposals: db.scheduleProposals || {},
    sheetTeamRoles: db.sheetTeamRoles || {},
    teamMappings: db.teamMappings || {},
    vetoes: db.vetoes || {},
    streamRequests: db.streamRequests || {},
    adminTickets: db.adminTickets || {},
    auditLog: Array.isArray(db.auditLog) ? db.auditLog : [],
    sclDemos: db.sclDemos || {},
    sclMessages: db.sclMessages || {},
    mainStreamCoverage: db.mainStreamCoverage || {},
    matchConnections: db.matchConnections || {},
    seasons: Array.isArray(db.seasons) ? db.seasons : [],
    sheetSync: db.sheetSync || {}
  };
}

async function writeDb(db) {
  await fs.writeFile(dbPath, JSON.stringify(normalizeDb(db), null, 2));
}

function mutateDb(mutator) {
  const operation = mutationQueue.then(async () => {
    const db = normalizeDb(await readDb());
    const result = await mutator(db);
    await writeDb(db);
    return result;
  });
  mutationQueue = operation.catch(() => null);
  return operation;
}

async function snapshot() {
  await mutationQueue;
  return normalizeDb(await readDb());
}

export async function saveMatch(match, discordIds) {
  return mutateDb((db) => {
    const existing = db.matches[match.id] || {};
    db.matches[match.id] = {
      match,
      discord: {
        ...(existing.discord || {}),
        ...discordIds
      },
      updatedAt: new Date().toISOString()
    };
  });
}

// Replaces every stale match record for one Discord channel with the new FACEIT
// match while preserving schedules, proposals, veto state, tickets, and streams.
export async function relinkMatchChannel(match, discordIds) {
  return mutateDb((db) => {
    const staleEntries = Object.entries(db.matches)
      .filter(([matchId, entry]) => matchId !== match.id && entry.discord?.channelId === discordIds.channelId)
      .sort(([, a], [, b]) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    const staleIds = staleEntries.map(([matchId]) => matchId);
    const staleIdSet = new Set(staleIds);
    const previous = staleEntries[0]?.[1] || null;

    const previousSchedule = staleIds
      .map((matchId) => db.schedules[matchId])
      .filter(Boolean)
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0] || null;
    if (previousSchedule && !db.schedules[match.id]) db.schedules[match.id] = previousSchedule;

    for (const proposal of Object.values(db.scheduleProposals)) {
      if (staleIdSet.has(proposal.matchId)) proposal.matchId = match.id;
    }
    for (const request of Object.values(db.streamRequests)) {
      if (!staleIdSet.has(request.matchId)) continue;
      request.matchId = match.id;
      request.faceitUrl = match.faceitUrl || request.faceitUrl;
      request.matchup = `${match.teamA} vs ${match.teamB}`;
    }
    for (const ticket of Object.values(db.adminTickets)) {
      if (staleIdSet.has(ticket.matchId)) ticket.matchId = match.id;
    }

    const previousVetoId = staleIds.find((matchId) => db.vetoes[matchId]);
    if (previousVetoId && !db.vetoes[match.id]) {
      db.vetoes[match.id] = { ...db.vetoes[previousVetoId], matchId: match.id };
    }

    for (const matchId of staleIds) {
      delete db.matches[matchId];
      delete db.schedules[matchId];
      delete db.vetoes[matchId];
    }

    db.matches[match.id] = {
      match,
      discord: {
        ...(previous?.discord || {}),
        ...discordIds
      },
      updatedAt: new Date().toISOString()
    };
    return { staleIds, discord: db.matches[match.id].discord };
  });
}

export async function saveMatchIntroMessageId(matchId, introMessageId) {
  return mutateDb((db) => {
    if (!db.matches[matchId]) return;
    db.matches[matchId].discord = {
      ...(db.matches[matchId].discord || {}),
      introMessageId
    };
    db.matches[matchId].updatedAt = new Date().toISOString();
  });
}

export async function listStoredMatches() {
  const db = await snapshot();
  return Object.values(db.matches);
}

export async function getStoredMatch(matchId) {
  const db = await snapshot();
  return db.matches[matchId] || null;
}

export async function getStoredMatchByChannel(channelId) {
  const db = await snapshot();
  return Object.values(db.matches).find((entry) => entry.discord?.channelId === channelId) || null;
}

export async function getSheetTeamRoleIds(guildId) {
  const db = await snapshot();
  return db.sheetTeamRoles[guildId] || {};
}

export async function saveSheetTeamRoleIds(guildId, roleIdsByTeamName) {
  return mutateDb((db) => {
    db.sheetTeamRoles[guildId] = {
      ...(db.sheetTeamRoles[guildId] || {}),
      ...roleIdsByTeamName,
      updatedAt: new Date().toISOString()
    };
  });
}

export async function saveSchedule(matchId, schedule) {
  return mutateDb((db) => {
    db.schedules[matchId] = {
      ...(db.schedules[matchId] || {}),
      ...schedule,
      updatedAt: new Date().toISOString()
    };
  });
}

export async function getSchedule(matchId) {
  const db = await snapshot();
  return db.schedules[matchId] || null;
}

export async function saveScheduleProposal(proposal) {
  return mutateDb((db) => {
    const existing = db.scheduleProposals[proposal.id] || {};
    db.scheduleProposals[proposal.id] = {
      ...existing,
      ...proposal,
      createdAt: existing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  });
}

export async function getScheduleProposal(proposalId) {
  const db = await snapshot();
  return db.scheduleProposals[proposalId] || null;
}

export async function getLatestOpenScheduleProposalForMatch(matchId) {
  const db = await snapshot();
  return Object.values(db.scheduleProposals)
    .filter((proposal) => proposal.matchId === matchId && !proposal.accepted && !proposal.declined && !proposal.canceled)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
}

export async function acceptScheduleProposal(proposalId, acceptedBy) {
  return mutateDb((db) => {
    const proposal = db.scheduleProposals[proposalId];
    if (!proposal || proposal.declined || proposal.canceled || proposal.accepted) return null;
    db.scheduleProposals[proposalId] = {
      ...proposal,
      accepted: true,
      acceptedBy,
      updatedAt: new Date().toISOString()
    };
    db.schedules[proposal.matchId] = {
      ...(db.schedules[proposal.matchId] || {}),
      scheduledAt: proposal.scheduledAt,
      scheduledAtIso: proposal.scheduledAtIso || null,
      timezone: proposal.timezone,
      proposedBy: proposal.proposedBy,
      acceptedBy,
      proposalId,
      kind: proposal.kind || 'schedule',
      updatedAt: new Date().toISOString()
    };
    return db.scheduleProposals[proposalId];
  });
}

export async function approveScheduleProposal(proposalId, approvedBy) {
  return mutateDb((db) => {
    const proposal = db.scheduleProposals[proposalId];
    if (!proposal || proposal.canceled || proposal.adminDenied || proposal.adminApproved) return null;
    db.scheduleProposals[proposalId] = {
      ...proposal,
      adminApproved: true,
      approvedBy,
      updatedAt: new Date().toISOString()
    };
    db.schedules[proposal.matchId] = {
      ...(db.schedules[proposal.matchId] || {}),
      scheduledAt: proposal.scheduledAt,
      scheduledAtIso: proposal.scheduledAtIso || db.schedules[proposal.matchId]?.scheduledAtIso || null,
      timezone: proposal.timezone,
      adminApproved: true,
      approvedBy,
      overrideReason: proposal.overrideReason || null,
      updatedAt: new Date().toISOString()
    };
    return db.scheduleProposals[proposalId];
  });
}

export async function denyScheduleProposal(proposalId, deniedBy, reason = '') {
  return mutateDb((db) => {
    const proposal = db.scheduleProposals[proposalId];
    if (!proposal || proposal.canceled || proposal.adminApproved || proposal.adminDenied) return null;
    db.scheduleProposals[proposalId] = {
      ...proposal,
      adminDenied: true,
      deniedBy,
      denialReason: reason || null,
      updatedAt: new Date().toISOString()
    };
    return db.scheduleProposals[proposalId];
  });
}

export async function declineScheduleProposal(proposalId, declinedBy) {
  return mutateDb((db) => {
    const proposal = db.scheduleProposals[proposalId];
    if (!proposal || proposal.accepted || proposal.declined || proposal.canceled) return null;
    db.scheduleProposals[proposalId] = {
      ...proposal,
      declined: true,
      declinedBy,
      updatedAt: new Date().toISOString()
    };
    return db.scheduleProposals[proposalId];
  });
}

export async function cancelScheduleProposal(proposalId, canceledBy) {
  return mutateDb((db) => {
    const proposal = db.scheduleProposals[proposalId];
    if (!proposal || proposal.accepted || proposal.declined || proposal.canceled || proposal.adminApproved) return null;
    db.scheduleProposals[proposalId] = {
      ...proposal,
      canceled: true,
      canceledBy,
      updatedAt: new Date().toISOString()
    };
    return db.scheduleProposals[proposalId];
  });
}

export async function listSchedules() {
  return Object.entries((await snapshot()).schedules)
    .map(([matchId, schedule]) => ({ matchId, ...schedule }));
}

export async function listScheduleProposals() {
  return Object.values((await snapshot()).scheduleProposals);
}

export async function saveTeamMapping(scopeKey, mapping) {
  return mutateDb((db) => {
    db.teamMappings[scopeKey] ||= {};
    const identity = String(mapping.identity || mapping.faceitTeamId || '').trim();
    if (!identity) throw new Error('Team mapping identity is required');
    const existing = db.teamMappings[scopeKey][identity] || {};
    db.teamMappings[scopeKey][identity] = {
      ...existing,
      ...mapping,
      identity,
      aliases: [...new Set([...(existing.aliases || []), ...(mapping.aliases || []), mapping.teamName].filter(Boolean))],
      createdAt: existing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    return db.teamMappings[scopeKey][identity];
  });
}

export async function listTeamMappings(scopeKey) {
  return Object.values((await snapshot()).teamMappings[scopeKey] || {});
}

export async function saveVeto(veto, expectedVersion = null) {
  return mutateDb((db) => {
    const existing = db.vetoes[veto.matchId] || null;
    if (expectedVersion !== null && Number(existing?.version || 0) !== Number(expectedVersion)) {
      const error = new Error('This veto changed before your action was processed. Refresh and try again.');
      error.code = 'STALE_VETO';
      throw error;
    }
    db.vetoes[veto.matchId] = {
      ...(existing || {}),
      ...veto,
      version: Number(existing?.version || 0) + 1,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    return db.vetoes[veto.matchId];
  });
}

export async function getVeto(matchId) {
  return (await snapshot()).vetoes[matchId] || null;
}

export async function listVetoes() {
  return Object.values((await snapshot()).vetoes);
}

export async function createStreamRequest(request) {
  return mutateDb((db) => {
    if (db.streamRequests[request.id]) throw new Error('Stream request ID already exists');
    db.streamRequests[request.id] = {
      ...request,
      status: request.status || 'pending',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    return db.streamRequests[request.id];
  });
}

export async function createStreamRequestUnlessActive(request) {
  return mutateDb((db) => {
    const activeStatuses = new Set(STREAM_ACTIVE_STATUSES);
    const existing = Object.values(db.streamRequests).find((entry) => {
      if (entry.requesterId !== request.requesterId || !activeStatuses.has(entry.status)) return false;
      if (request.matchId) return entry.matchId === request.matchId;
      return !entry.matchId && entry.faceitUrl === request.faceitUrl;
    });
    if (existing) return { created: false, request: existing };

    db.streamRequests[request.id] = {
      ...request,
      status: request.status || 'pending',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    return { created: true, request: db.streamRequests[request.id] };
  });
}

export async function getStreamRequest(id) {
  return (await snapshot()).streamRequests[id] || null;
}

export async function listStreamRequests(filters = {}) {
  return Object.values((await snapshot()).streamRequests).filter((request) =>
    (!filters.status || request.status === filters.status) &&
    (!filters.matchId || request.matchId === filters.matchId) &&
    (!filters.requesterId || request.requesterId === filters.requesterId)
  );
}

export async function updateStreamRequest(id, patch, allowedStatuses = null) {
  return mutateDb((db) => {
    const existing = db.streamRequests[id];
    if (!existing) return null;
    if (allowedStatuses && !allowedStatuses.includes(existing.status)) return null;
    db.streamRequests[id] = {
      ...existing,
      ...patch,
      version: Number(existing.version || 0) + 1,
      updatedAt: new Date().toISOString()
    };
    return db.streamRequests[id];
  });
}

// Approval is a two-step claim so that two staff members racing on the same
// card cannot both approve, and so a website publish that fails or is
// interrupted by a restart is visible and retryable instead of silently lost.
export async function claimStreamApproval(id, actorId) {
  return transitionStreamRequest(id, ['pending'], 'approving', {
    reviewedBy: actorId,
    reviewedAt: new Date().toISOString(),
    denialReason: null,
    lastPublishError: null
  });
}

export async function claimStreamRepublish(id, actorId = null) {
  return transitionStreamRequest(id, ['publish_failed'], 'approving', {
    ...(actorId ? { republishRequestedBy: actorId } : {}),
    lastPublishError: null
  });
}

export async function recordStreamPublishResult(id, { ok, websiteId = null, error = null }) {
  return mutateDb((db) => {
    const existing = db.streamRequests[id];
    if (!existing || existing.status !== 'approving') return null;
    const now = new Date().toISOString();
    db.streamRequests[id] = {
      ...existing,
      status: ok ? 'approved' : 'publish_failed',
      publishAttempts: Number(existing.publishAttempts || 0) + 1,
      websiteId: ok ? (websiteId || existing.websiteId || null) : existing.websiteId || null,
      websitePublishedAt: ok ? now : existing.websitePublishedAt || null,
      websiteSyncError: ok ? null : existing.websiteSyncError || null,
      lastPublishError: ok ? null : String(error || 'unknown error'),
      version: Number(existing.version || 0) + 1,
      updatedAt: now
    };
    return db.streamRequests[id];
  });
}

// Called on startup: anything still `approving` was interrupted mid-publish.
export async function recoverInterruptedStreamPublishes() {
  return mutateDb((db) => {
    const recovered = [];
    const now = new Date().toISOString();
    for (const request of Object.values(db.streamRequests)) {
      if (request.status !== 'approving') continue;
      db.streamRequests[request.id] = {
        ...request,
        status: 'publish_failed',
        lastPublishError: 'Bot restarted while publishing to the website; retry needed.',
        version: Number(request.version || 0) + 1,
        updatedAt: now
      };
      recovered.push(db.streamRequests[request.id]);
    }
    return recovered;
  });
}

// Requests saved while the staff channel was unreachable, so they can be re-posted.
export async function listStreamRequestsAwaitingStaffPost() {
  return Object.values((await snapshot()).streamRequests).filter((request) =>
    ['pending', 'submission_failed'].includes(request.status) && !request.staffMessageId
  );
}

function transitionStreamRequest(id, fromStatuses, toStatus, patch = {}) {
  return mutateDb((db) => {
    const existing = db.streamRequests[id];
    if (!existing || !fromStatuses.includes(existing.status)) return null;
    db.streamRequests[id] = {
      ...existing,
      ...patch,
      status: toStatus,
      version: Number(existing.version || 0) + 1,
      updatedAt: new Date().toISOString()
    };
    return db.streamRequests[id];
  });
}

export async function claimStreamDeliveryPrompt(matchId, force = false) {
  return mutateDb((db) => {
    const requests = Object.values(db.streamRequests).filter((request) =>
      request.matchId === matchId && request.status === 'approved'
    );
    if (!requests.length || (!force && requests.every((request) => request.deliveryPromptSentAt))) return null;
    const claimedAt = new Date().toISOString();
    for (const request of requests) {
      db.streamRequests[request.id] = {
        ...request,
        deliveryPromptSentAt: claimedAt,
        deliveryPromptMessageId: null,
        version: Number(request.version || 0) + 1,
        updatedAt: claimedAt
      };
    }
    return requests.map((request) => db.streamRequests[request.id]);
  });
}

export async function claimPostCastReminder(id) {
  return mutateDb((db) => {
    const existing = db.streamRequests[id];
    const claimedAt = Date.parse(existing?.postCastReminderClaimedAt || '');
    const claimIsFresh = Number.isFinite(claimedAt) && Date.now() - claimedAt < 10 * 60 * 1000;
    if (!existing || existing.status !== 'approved' || existing.postCastReminderSentAt || claimIsFresh) {
      return null;
    }
    db.streamRequests[id] = {
      ...existing,
      postCastReminderClaimedAt: new Date().toISOString(),
      version: Number(existing.version || 0) + 1,
      updatedAt: new Date().toISOString()
    };
    return db.streamRequests[id];
  });
}

export async function saveAdminTicket(ticket) {
  return mutateDb((db) => {
    const existing = db.adminTickets[ticket.id] || {};
    db.adminTickets[ticket.id] = {
      ...existing,
      ...ticket,
      createdAt: existing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    return db.adminTickets[ticket.id];
  });
}

export async function listAdminTickets(filters = {}) {
  return Object.values((await snapshot()).adminTickets).filter((ticket) =>
    (!filters.status || ticket.status === filters.status) &&
    (!filters.matchId || ticket.matchId === filters.matchId)
  );
}

export async function appendAuditLog(event) {
  return mutateDb((db) => {
    const entry = {
      id: event.id || `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      ...event,
      timestamp: event.timestamp || new Date().toISOString()
    };
    db.auditLog.push(entry);
    if (db.auditLog.length > 5000) db.auditLog.splice(0, db.auditLog.length - 5000);
    return entry;
  });
}

export async function listAuditLog(filters = {}) {
  return (await snapshot()).auditLog.filter((entry) =>
    (!filters.matchId || entry.matchId === filters.matchId) &&
    (!filters.type || entry.type === filters.type)
  );
}

export async function hasPostedSclDemo(matchId, mapNumber, viewerUrl) {
  const db = normalizeDb(await readDb());
  const key = sclDemoKey(matchId, mapNumber, viewerUrl);
  return Boolean(db.sclDemos[key]);
}

export async function savePostedSclDemo(matchId, map) {
  const db = normalizeDb(await readDb());
  const key = sclDemoKey(matchId, map.map_number, map.viewer_url);
  db.sclDemos[key] = {
    matchId,
    mapNumber: map.map_number,
    mapName: map.map_name,
    viewerUrl: map.viewer_url,
    postedAt: new Date().toISOString()
  };
  await writeDb(db);
}

export async function getSclDiscordMessage(matchId) {
  const db = normalizeDb(await readDb());
  return db.sclMessages[matchId] || null;
}

export async function saveSclDiscordMessage(matchId, channelId, messageId) {
  const db = normalizeDb(await readDb());
  db.sclMessages[matchId] = {
    matchId,
    channelId,
    messageId,
    updatedAt: new Date().toISOString()
  };
  await writeDb(db);
  return db.sclMessages[matchId];
}

function sclDemoKey(matchId, mapNumber, viewerUrl) {
  return `${matchId}:${mapNumber}:${viewerUrl}`;
}

// Matches the official CROSSFIRE broadcast is covering (`/cf mainstream`).
export async function saveMainStreamCoverage(matchId, patch) {
  return mutateDb((db) => {
    db.mainStreamCoverage[matchId] = {
      ...(db.mainStreamCoverage[matchId] || {}),
      ...patch,
      matchId,
      updatedAt: new Date().toISOString()
    };
    return db.mainStreamCoverage[matchId];
  });
}

// Takes a match off the main stream (the whole record goes; putting it back starts fresh).
export async function deleteMainStreamCoverage(matchId) {
  return mutateDb((db) => {
    const existing = db.mainStreamCoverage[matchId] || null;
    delete db.mainStreamCoverage[matchId];
    return existing;
  });
}

export async function getMainStreamCoverage(matchId) {
  return (await snapshot()).mainStreamCoverage[matchId] || null;
}

export async function listMainStreamCoverage() {
  return Object.values((await snapshot()).mainStreamCoverage || {});
}

// Claims the match-time "Main Stream Connection Needed" prompt once per match.
export async function claimMainStreamDeliveryPrompt(matchId) {
  return mutateDb((db) => {
    const coverage = db.mainStreamCoverage[matchId];
    if (!coverage || coverage.deliveryPromptSentAt) return null;
    coverage.deliveryPromptSentAt = new Date().toISOString();
    return { ...coverage };
  });
}

export async function listMainStreamCoverageMatchIds() {
  return Object.keys((await snapshot()).mainStreamCoverage || {});
}

// The daily open matches post: claimed once per Eastern date, so restarts or overlapping ticks
// never post twice.
export async function getOpenMatchesDigest() {
  return (await snapshot()).openMatchesDigest || null;
}

export async function claimOpenMatchesDigest(dateKey) {
  return mutateDb((db) => {
    if (db.openMatchesDigest?.dateKey === dateKey) return false;
    db.openMatchesDigest = { dateKey, claimedAt: new Date().toISOString() };
    return true;
  });
}

export async function saveOpenMatchesDigest(patch) {
  return mutateDb((db) => {
    db.openMatchesDigest = { ...(db.openMatchesDigest || {}), ...patch };
    return db.openMatchesDigest;
  });
}

// Last connection details staff entered for a match (CSTV connect / server IP),
// so a later `/cf mainstream` can post them without asking staff again.
export async function saveMatchConnection(matchId, connection) {
  return mutateDb((db) => {
    db.matchConnections[matchId] = { ...connection, matchId };
    return db.matchConnections[matchId];
  });
}

export async function getMatchConnection(matchId) {
  return (await snapshot()).matchConnections[matchId] || null;
}

// Seasons and their round windows (`/cf season`). See src/season.js for the rules.
export async function listSeasons() {
  return (await snapshot()).seasons;
}

// `plan` gets a copy of the seasons and returns { seasons, ... } to save, or { error } to save nothing.
export async function updateSeasons(plan) {
  return mutateDb((db) => {
    const result = plan(db.seasons.map((season) => ({ ...season })));
    if (result && !result.error && Array.isArray(result.seasons)) db.seasons = result.seasons;
    return result;
  });
}

// Runs once per data file: copies the old hard-coded season in when no season was ever saved.
export async function seedSeasonsOnce(seed) {
  return mutateDb((db) => {
    if (db.seasons.length || db.seasonsSeededAt) return null;
    const now = new Date().toISOString();
    const season = { ...seed, rounds: seed.rounds.map((round) => ({ ...round })), createdBy: null, createdAt: now, updatedAt: now };
    db.seasons = [season];
    db.seasonsSeededAt = now;
    return season;
  });
}

// What the bot has already written to the Google Sheet per match (results, stats ticks), so each
// is written once. Keys look like "result:<matchId>" and "stats:<matchId>".
export async function getSheetSync() {
  return (await snapshot()).sheetSync || {};
}

export async function updateSheetSync(key, patch) {
  return mutateDb((db) => {
    db.sheetSync[key] = { ...(db.sheetSync[key] || {}), ...patch, updatedAt: new Date().toISOString() };
    return db.sheetSync[key];
  });
}
