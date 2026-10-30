import 'dotenv/config';

const defaultTeamRoleIds = {
  'Holly Molly': '1531188646068224062',
  'New Legends': '1531188666087637042',
  'surge': '1531188666087637042',
  'Villainous': '1531188706000633998',
  'Team Skyline': '1531188750770765855',
  'Elusive': '1531188793313329172',
  'Unreal Nightmare': '1531188833675251713',
  'Olympus': '1531188879791751238',
  'Detonate': '1531188931113259029',
  'Beyond Limits': '1531189002491924542',
  'Zomblers': '1531189050038292591',
  'Ninefly Esports': '1531189097723596831',
  'NineFly Esports': '1531189097723596831',
  'Regain': '1531189152530436218',
  'LAG': '1531189193840263188',
  "Life's A Game": '1531189193840263188',
  'Lifes A Game': '1531189193840263188',
  'Aspyre': '1531189197405425846',
  'Dice': '1531189231978938499',
  'Wanted Goons': '1531189272823201908',
  'Squad Up': '1531189323570090015',
  'Squad up': '1531189323570090015',
  'Squadup': '1531189323570090015',
  'Team Fathom Gaming': '1531189371342950443',
  'Fathom Gaming': '1531189371342950443',
  'House Platypus ESP(HPLAT)': '1531189451802415114',
  'House Platypus ESP': '1531189451802415114',
  'House Platypus ESC': '1531189451802415114',
  'HPLAT': '1531189451802415114',
  'Aura': '1531189502708682753',
  'NuTorious': '1531189557465186462',
  'Nutorious': '1531189557465186462',
  'Team Amplus': '1531189637035458747',
  'Empire': '1531189683101503618',
  'Arctic Ace': '1531189718929379430',
  'Omen Esports': '1531189733978411019',
  'North Forge': '1531189768984203325',
  'Overtake Sector': '1531189815138320504',
  'F5 Esports': '1531189851750269068',
  'Atlantis Esports': '1531189895152795769',
  'Without a Roof': '1531189911779282994',
  'Without A Roof': '1531189911779282994',
  'Chicken Coop': '1531189942728785990',
  'Chicken Coop Esports': '1531189942728785990',
  'Farmville': '1531189990405439549',
  'Kodex Esports': '1531190039491510377',
  'KODEX Esports': '1531190039491510377',
  "O'Fire Esports": '1531190083758329972',
  'OFire Esports': '1531190083758329972',
  'O Fire': '1531190083758329972',
  'O Fire Esports': '1531190083758329972',
  'UltimateDarklordWizardz': '1531190087721943141',
  'counterstrike team': '1531190134106755264',
  'BabaG': '1531190184735936572',
  'Tractors': '1531190216574894281',
  'House Spartans': '1531190229397012500',
  'Marsborne': '1531190272799543348',
  'Team Factor': '1531414073059705053',
  'Iowa Stormboar': '1531414142328504443',
  'Celestial Esports': '1531503854213140570',
  'Club 333': '1532173592203104317',
  'CLUB 333': '1532173592203104317',
  'NXG': '1532173593340022786',
  'NXG Esports': '1532173593340022786',
  'Addice': '1532173602990981281',
  'deez': '1533984391758479380',
  'Demolition': '1533984393700315226',
  'my life be like': '1533984394593959957',
  'Mylifebelike': '1533984394593959957',
  'MyLifeBeLike': '1533984394593959957',
  'Enigma': '1533984395298476195',
  'VerhovnaRada': '1538326444604788836',
  'FlyQuest Red': '1538326445657428119',
  'Conscious Gaming': '1538326446181974088',
  'ASCEND': '1538326447209316402',
  'Bucket Jon Boys': '1538326449076047942',
  'Bucketjonboys': '1538326449076047942',
  'BucketJonsBoys': '1538326449076047942',
  'ThirdSite': '1538326449982013572'
};

const defaultMatchChannelIds = {
  'Chicken Coop Esports|Mylifebelike': '1548122005134381267',
  'Chicken Coop|my life be like': '1548122005134381267',
  'Detonate|Arctic Ace': '1548120903424938015',
  'Zomblers|Olympus': '1548121098242236476',
  'EMPIRE|BucketJonsBoys': '1548121208472477726',
  'Empire|Bucket Jon Boys': '1548121208472477726',
  'LAG|Overtake Sector': '1548121258888274030',
  'F5 Esports|Atlantis Esports': '1548121310956359811',
  'Villainous|New Legends': '1548121385254133770',
  'Wanted Goons|Unreal Nightmare': '1548121505051836476',
  'Marsborne|Fathom Gaming': '1548121531044069437',
  'Marsborne|Team Fathom Gaming': '1548121531044069437',
  'Club 333|KODEX Esports': '1548121557316931727',
  'Club 333|Kodex Esports': '1548121557316931727',
  'Iowa Stormboar|Omen Esports': '1548121655103193251',
  'Farmville|Celestial Esports': '1548121691203436554',
  'Regain|Addice': '1548121709196873801',
  'BabaG|FlyQuest Red': '1548121727123324948',
  'Nutorious|North Forge': '1548121742034079755',
  'NuTorious|North Forge': '1548121742034079755',
  'Without a Roof|Beyond Limits': '1548121758643789904',
  'Without A Roof|Beyond Limits': '1548121758643789904'
};

const defaultRoundCategoryIds = {
  'Upper Bracket - Round 1': '1548120902154068039',
  'WB Round of 32': '1548120902154068039'
};

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

  const commandGuildIds = [
    process.env.DISCORD_GUILD_ID,
    ...parseSnowflakeList(process.env.DISCORD_COMMAND_GUILD_IDS || '')
  ].filter((value, index, values) => value && values.indexOf(value) === index);

  const websiteEndpoint = process.env.WEBSITE_ENDPOINT?.trim() || '';
  if (websiteEndpoint && !/^https?:\/\//i.test(websiteEndpoint)) {
    throw new Error('WEBSITE_ENDPOINT must be an http(s) URL');
  }
  if (websiteEndpoint && !process.env.WEBSITE_API_KEY?.trim()) {
    throw new Error('WEBSITE_API_KEY is required when WEBSITE_ENDPOINT is set');
  }

  const scheduleSheetWebhookUrl = process.env.SCHEDULE_SHEET_WEBHOOK_URL?.trim() || '';
  if (scheduleSheetWebhookUrl && !/^https?:\/\//i.test(scheduleSheetWebhookUrl)) {
    throw new Error('SCHEDULE_SHEET_WEBHOOK_URL must be an http(s) URL');
  }
  if (scheduleSheetWebhookUrl && !process.env.SCHEDULE_SHEET_SECRET?.trim()) {
    throw new Error('SCHEDULE_SHEET_SECRET is required when SCHEDULE_SHEET_WEBHOOK_URL is set');
  }

  return {
    discordToken: process.env.DISCORD_TOKEN,
    discordClientId: process.env.DISCORD_CLIENT_ID,
    discordGuildId: process.env.DISCORD_GUILD_ID,
    commandGuildIds,
    discordStaffRoleId: process.env.DISCORD_STAFF_ROLE_ID || null,
    adminScheduleChannelId: process.env.ADMIN_SCHEDULE_CHANNEL_ID || null,
    callAdminChannelId: process.env.CALL_ADMIN_CHANNEL_ID || process.env.ADMIN_SCHEDULE_CHANNEL_ID || null,
    adminAlertRoleIds: parseCsvValue(process.env.ADMIN_ALERT_ROLE_IDS || ''),
    rosterTicketChannelId: process.env.ROSTER_TICKET_CHANNEL_ID || '1418725495545004175',
    matchAccessRoleIds: parseCsvValue(process.env.MATCH_ACCESS_ROLE_IDS || '1128907825167482900,1353921199016644700'),
    matchAccessRoleNames: parseCsvValue(process.env.MATCH_ACCESS_ROLE_NAMES || ''),
    scheduleOverrideRoleIds: parseCsvValue(process.env.SCHEDULE_OVERRIDE_ROLE_IDS || '1128907825167482900'),
    authorizedStaffRoleIds: parseCsvValue(process.env.AUTHORIZED_STAFF_ROLE_IDS || [
      process.env.DISCORD_STAFF_ROLE_ID,
      process.env.ADMIN_ALERT_ROLE_IDS
    ].filter(Boolean).join(',')),
    roleSyncPairs: parseRoleSyncPairs(
      process.env.ROLE_SYNC_PAIRS ||
      '1128905368018354277:1128907940720562296=1473173377005912074:1474117290600562920'
    ),
    teamRoleIds: parseTeamRoleIds(process.env.TEAM_ROLE_IDS || ''),
    matchChannelIds: parseMatchChannelIds(process.env.MATCH_CHANNEL_IDS || ''),
    roundCategoryIds: parseRoundCategoryIds(process.env.ROUND_CATEGORY_IDS || ''),
    createMissingMatchTeamRoles: process.env.CREATE_MISSING_MATCH_TEAM_ROLES === 'true',
    createMissingTeamRoles: process.env.CREATE_MISSING_TEAM_ROLES === 'true',
    createNewSeasonTeamRoles: process.env.CREATE_NEW_SEASON_TEAM_ROLES === 'true',
    faceitApiKey: process.env.FACEIT_API_KEY,
    faceitSources,
    faceitScheduleEndpoint: process.env.FACEIT_SCHEDULE_ENDPOINT || null,
    port: Number(process.env.PORT || process.env.WEBHOOK_PORT || 0) || null,
    sclApiKey: process.env.SCL_API_KEY || null,
    sclWebhookSecret: process.env.SCL_WEBHOOK_SECRET || null,
    sclWebhookPath: process.env.SCL_WEBHOOK_PATH || '/webhooks/scl',
    googleSheetCsvUrl: process.env.GOOGLE_SHEET_CSV_URL || null,
    seasonParticipantRoleId: process.env.SEASON_PARTICIPANT_ROLE_ID || null,
    seasonParticipantRoleName: process.env.SEASON_PARTICIPANT_ROLE_NAME || 'Season Participant',
    teamCaptainRoleId: process.env.TEAM_CAPTAIN_ROLE_ID || null,
    teamCaptainRoleName: process.env.TEAM_CAPTAIN_ROLE_NAME || 'Team Captain',
    updateTeamNicknames: process.env.UPDATE_TEAM_NICKNAMES !== 'false',
    teamMappingSeasonId: process.env.TEAM_MAPPING_SEASON_ID || faceitSources[0]?.id || 'default',
    playoffSourceIds: parseCsvValue(process.env.PLAYOFF_SOURCE_IDS || faceitSources
      .filter((source) => /playoff/i.test(source.name || ''))
      .map((source) => source.id)
      .join(',')),
    vetoMapPool: parseCsvValue(process.env.VETO_MAP_POOL || ''),
    vetoSeeds: parseNamedNumbers(process.env.VETO_SEEDS || ''),
    vetoCaptainOnly: process.env.VETO_CAPTAIN_ONLY !== 'false',
    vetoSidePolicy: process.env.VETO_SIDE_POLICY || 'Staff decides sides after the Discord veto.',
    vetoAdvantageTeam: process.env.VETO_ADVANTAGE_TEAM || null,
    vetoStaffChannelId: process.env.VETO_STAFF_CHANNEL_ID || process.env.ADMIN_SCHEDULE_CHANNEL_ID || null,
    streamRequestChannelId: process.env.STREAM_REQUEST_CHANNEL_ID || null,
    // Optional: when set, `/request stream` and `!request` only work in these channels.
    streamCommunityChannelIds: parseSnowflakeList(process.env.STREAM_COMMUNITY_CHANNEL_IDS || ''),
    // Optional: restrict accepted stream platforms (twitch, youtube, kick). Empty = all.
    streamAllowedPlatforms: parseCsvValue(process.env.STREAM_ALLOWED_PLATFORMS || '').map((value) => value.toLowerCase()),
    // Website integration for approved streams. Empty endpoint = log-only mode.
    websiteEndpoint: websiteEndpoint || null,
    websiteApiKey: process.env.WEBSITE_API_KEY?.trim() || null,
    websiteTimeoutSeconds: Math.max(1, Number(process.env.WEBSITE_TIMEOUT_SECONDS || 10) || 10),
    websiteMaxAttempts: Math.max(1, Number(process.env.WEBSITE_MAX_ATTEMPTS || 3) || 3),
    // Google Sheet schedule log through an Apps Script web app. Empty URL = log-only mode.
    scheduleSheetWebhookUrl: scheduleSheetWebhookUrl || null,
    scheduleSheetSecret: process.env.SCHEDULE_SHEET_SECRET?.trim() || null,
    scheduleSheetTimeoutSeconds: Math.max(1, Number(process.env.SCHEDULE_SHEET_TIMEOUT_SECONDS || 10) || 10),
    streamStaffGuildId: process.env.STREAM_STAFF_GUILD_ID || '1473173377005912074',
    streamStaffRoleIds: parseCsvValue(process.env.STREAM_STAFF_ROLE_IDS || '1474118305169019163'),
    streamScheduleCheckMinutes: Math.max(15, Math.min(30, Number(process.env.STREAM_SCHEDULE_CHECK_MINUTES || 20))),
    streamGuidelinesUrl: process.env.STREAM_GUIDELINES_URL || null,
    streamGuidelinesText: process.env.STREAM_GUIDELINES_TEXT || 'Follow all CROSSFIRE co-streaming rules and do not restream the official broadcast without explicit permission.',
    postCastFormUrl: process.env.POST_CAST_FORM_URL || 'https://forms.gle/6zwVr2ArfFngGQ2NA',
    rulesUrl: process.env.CROSSFIRE_RULES_URL || null,
    arenaClubId: process.env.ARENA_CLUB_ID || '5c8215bf-be47-4714-8738-2d7038b5d9c3',
    roundWindows: parseRoundWindows(process.env.ROUND_WINDOWS || ''),
    defaultTimezone: process.env.DEFAULT_TIMEZONE || 'America/New_York'
  };
}

function parseNamedNumbers(value) {
  const result = new Map();
  for (const entry of String(value || '').split(';').map((part) => part.trim()).filter(Boolean)) {
    const separator = entry.lastIndexOf('=');
    if (separator < 1) continue;
    const name = normalizeTeamKey(entry.slice(0, separator));
    const number = Number(entry.slice(separator + 1));
    if (name && Number.isInteger(number) && number > 0) result.set(name, number);
  }
  return result;
}

function parseRoleSyncPairs(value) {
  return value
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [left, right] = entry.split('=').map((part) => parseRoleSyncSide(part));
      if (!left || !right) return null;
      return { left, right };
    })
    .filter(Boolean);
}

function parseRoleSyncSide(value) {
  const [guildId, roleId] = String(value || '').split(':').map((part) => part.trim());
  if (!/^\d{15,25}$/.test(guildId || '') || !/^\d{15,25}$/.test(roleId || '')) {
    return null;
  }

  return { guildId, roleId };
}

function parseTeamRoleIds(value) {
  const roles = new Map();

  for (const entry of value.split(';').map((part) => part.trim()).filter(Boolean)) {
    const [name, roleId] = entry.split('=').map((part) => part.trim());
    if (name && /^\d{15,25}$/.test(roleId || '')) {
      roles.set(normalizeTeamKey(name), roleId);
    }
  }

  return roles;
}

function parseMatchChannelIds(value) {
  const channels = new Map();

  for (const entry of value.split(';').map((part) => part.trim()).filter(Boolean)) {
    const [pair, channelId] = entry.split('=').map((part) => part.trim());
    const [teamA, teamB] = String(pair || '').split('|').map((part) => part.trim());
    if (teamA && teamB && /^\d{15,25}$/.test(channelId || '')) {
      channels.set(matchPairKey(teamA, teamB), channelId);
    }
  }

  return channels;
}

function parseRoundCategoryIds(value) {
  const categories = new Map();

  for (const entry of value.split(';').map((part) => part.trim()).filter(Boolean)) {
    const [roundName, categoryId] = entry.split('=').map((part) => part.trim());
    if (roundName && /^\d{15,25}$/.test(categoryId || '')) {
      categories.set(normalizeTeamKey(roundName), categoryId);
    }
  }

  return categories;
}

function matchPairKey(teamA, teamB) {
  return [normalizeTeamKey(teamA), normalizeTeamKey(teamB)].sort().join('|');
}

function normalizeTeamKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function parseCsvValue(value) {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseSnowflakeList(value) {
  return String(value || '')
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter((part) => /^\d{15,25}$/.test(part));
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
