import 'dotenv/config';

const required = [
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_GUILD_ID',
  'FACEIT_API_KEY',
  'FACEIT_SOURCES'
];

export function getConfig() {
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing environment values: ${missing.join(', ')}`);
  }

  const faceitSources = process.env.FACEIT_SOURCES
    .split(',')
    .map(parseFaceitSource)
    .filter(Boolean);

  if (!faceitSources.length) {
    throw new Error('FACEIT_SOURCES must include at least one source');
  }

  return {
    discordToken: process.env.DISCORD_TOKEN,
    discordClientId: process.env.DISCORD_CLIENT_ID,
    discordGuildId: process.env.DISCORD_GUILD_ID,
    discordStaffRoleId: process.env.DISCORD_STAFF_ROLE_ID || null,
    adminScheduleChannelId: process.env.ADMIN_SCHEDULE_CHANNEL_ID || null,
    adminAlertRoleIds: parseCsvValue(process.env.ADMIN_ALERT_ROLE_IDS || ''),
    matchAccessRoleIds: parseCsvValue(process.env.MATCH_ACCESS_ROLE_IDS || ''),
    matchAccessRoleNames: parseCsvValue(process.env.MATCH_ACCESS_ROLE_NAMES || ''),
    createMissingTeamRoles: process.env.CREATE_MISSING_TEAM_ROLES === 'true',
    faceitApiKey: process.env.FACEIT_API_KEY,
    faceitSources,
    faceitScheduleEndpoint: process.env.FACEIT_SCHEDULE_ENDPOINT || null,
    googleSheetCsvUrl: process.env.GOOGLE_SHEET_CSV_URL || null,
    seasonParticipantRoleId: process.env.SEASON_PARTICIPANT_ROLE_ID || null,
    seasonParticipantRoleName: process.env.SEASON_PARTICIPANT_ROLE_NAME || 'Season Participant',
    teamCaptainRoleId: process.env.TEAM_CAPTAIN_ROLE_ID || null,
    teamCaptainRoleName: process.env.TEAM_CAPTAIN_ROLE_NAME || 'Team Captain',
    updateTeamNicknames: process.env.UPDATE_TEAM_NICKNAMES !== 'false',
    arenaClubId: process.env.ARENA_CLUB_ID || '5c8215bf-be47-4714-8738-2d7038b5d9c3',
    roundWindows: parseRoundWindows(process.env.ROUND_WINDOWS || ''),
    defaultTimezone: process.env.DEFAULT_TIMEZONE || 'America/New_York'
  };
}

function parseCsvValue(value) {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseRoundWindows(value) {
  const windows = {};

  for (const entry of value.split(';').map((part) => part.trim()).filter(Boolean)) {
    const [roundName, range] = entry.split('=').map((part) => part.trim());
    const [start, end] = String(range || '').split('..').map((part) => part.trim());
    if (!roundName || !start || !end) continue;

    windows[roundName.toLowerCase()] = { start, end };
  }

  return windows;
}

function parseFaceitSource(value) {
  const [type, id, ...nameParts] = value.split(':').map((part) => part.trim());
  if (!type || !id) return null;

  const sourceType = type.toLowerCase();
  if (!['championship', 'tournament'].includes(sourceType)) {
    throw new Error(`Invalid FACEIT source type: ${type}`);
  }

  return {
    type: sourceType,
    id,
    name: nameParts.join(':') || id
  };
}
