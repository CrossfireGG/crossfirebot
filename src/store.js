import fs from 'node:fs/promises';
import path from 'node:path';

const dbPath = path.resolve('bot-data.json');

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
    matches: db.matches || {},
    schedules: db.schedules || {},
    scheduleProposals: db.scheduleProposals || {},
    sheetTeamRoles: db.sheetTeamRoles || {},
    sclDemos: db.sclDemos || {},
    sclMessages: db.sclMessages || {}
  };
}

async function writeDb(db) {
  await fs.writeFile(dbPath, JSON.stringify(db, null, 2));
}

export async function saveMatch(match, discordIds) {
  const db = normalizeDb(await readDb());
  const existing = db.matches[match.id] || {};
  db.matches[match.id] = {
    match,
    discord: {
      ...(existing.discord || {}),
      ...discordIds
    },
    updatedAt: new Date().toISOString()
  };
  await writeDb(db);
}

export async function saveMatchIntroMessageId(matchId, introMessageId) {
  const db = normalizeDb(await readDb());
  if (!db.matches[matchId]) return;

  db.matches[matchId].discord = {
    ...(db.matches[matchId].discord || {}),
    introMessageId
  };
  db.matches[matchId].updatedAt = new Date().toISOString();
  await writeDb(db);
}

export async function listStoredMatches() {
  const db = normalizeDb(await readDb());
  return Object.values(db.matches);
}

export async function getStoredMatch(matchId) {
  const db = normalizeDb(await readDb());
  return db.matches[matchId] || null;
}

export async function getStoredMatchByChannel(channelId) {
  const db = normalizeDb(await readDb());
  return Object.values(db.matches).find((entry) => entry.discord?.channelId === channelId) || null;
}

export async function getSheetTeamRoleIds(guildId) {
  const db = normalizeDb(await readDb());
  return db.sheetTeamRoles[guildId] || {};
}

export async function saveSheetTeamRoleIds(guildId, roleIdsByTeamName) {
  const db = normalizeDb(await readDb());
  db.sheetTeamRoles[guildId] = {
    ...(db.sheetTeamRoles[guildId] || {}),
    ...roleIdsByTeamName,
    updatedAt: new Date().toISOString()
  };
  await writeDb(db);
}

export async function saveSchedule(matchId, schedule) {
  const db = normalizeDb(await readDb());
  db.schedules[matchId] = {
    ...schedule,
    updatedAt: new Date().toISOString()
  };
  await writeDb(db);
}

export async function getSchedule(matchId) {
  const db = normalizeDb(await readDb());
  return db.schedules[matchId] || null;
}

export async function saveScheduleProposal(proposal) {
  const db = normalizeDb(await readDb());
  db.scheduleProposals[proposal.id] = {
    ...proposal,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await writeDb(db);
}

export async function getScheduleProposal(proposalId) {
  const db = normalizeDb(await readDb());
  return db.scheduleProposals[proposalId] || null;
}

export async function getLatestOpenScheduleProposalForMatch(matchId) {
  const db = normalizeDb(await readDb());
  return Object.values(db.scheduleProposals)
    .filter((proposal) => proposal.matchId === matchId && !proposal.accepted && !proposal.declined)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
}

export async function acceptScheduleProposal(proposalId, acceptedBy) {
  const db = normalizeDb(await readDb());
  const proposal = db.scheduleProposals[proposalId];
  if (!proposal) return null;

  db.scheduleProposals[proposalId] = {
    ...proposal,
    accepted: true,
    acceptedBy,
    updatedAt: new Date().toISOString()
  };
  db.schedules[proposal.matchId] = {
    scheduledAt: proposal.scheduledAt,
    timezone: proposal.timezone,
    proposedBy: proposal.proposedBy,
    acceptedBy,
    proposalId,
    kind: proposal.kind || 'schedule',
    updatedAt: new Date().toISOString()
  };
  await writeDb(db);
  return db.scheduleProposals[proposalId];
}

export async function approveScheduleProposal(proposalId, approvedBy) {
  const db = normalizeDb(await readDb());
  const proposal = db.scheduleProposals[proposalId];
  if (!proposal) return null;

  db.scheduleProposals[proposalId] = {
    ...proposal,
    adminApproved: true,
    approvedBy,
    updatedAt: new Date().toISOString()
  };
  if (db.schedules[proposal.matchId]) {
    db.schedules[proposal.matchId].adminApproved = true;
    db.schedules[proposal.matchId].approvedBy = approvedBy;
    db.schedules[proposal.matchId].updatedAt = new Date().toISOString();
  }
  await writeDb(db);
  return db.scheduleProposals[proposalId];
}

export async function denyScheduleProposal(proposalId, deniedBy) {
  const db = normalizeDb(await readDb());
  const proposal = db.scheduleProposals[proposalId];
  if (!proposal) return null;

  db.scheduleProposals[proposalId] = {
    ...proposal,
    adminDenied: true,
    deniedBy,
    updatedAt: new Date().toISOString()
  };
  await writeDb(db);
  return db.scheduleProposals[proposalId];
}

export async function declineScheduleProposal(proposalId, declinedBy) {
  const db = normalizeDb(await readDb());
  const proposal = db.scheduleProposals[proposalId];
  if (!proposal) return null;

  db.scheduleProposals[proposalId] = {
    ...proposal,
    declined: true,
    declinedBy,
    updatedAt: new Date().toISOString()
  };
  await writeDb(db);
  return db.scheduleProposals[proposalId];
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
