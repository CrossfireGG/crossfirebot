import crypto from 'node:crypto';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const SCHEDULE_HEADERS = [
  'Approved At',
  'Match',
  'Team A',
  'Team B',
  'Stage',
  'Round',
  'Group',
  'Scheduled Time',
  'Scheduled ISO',
  'Timezone',
  'FACEIT URL',
  'Discord Channel ID',
  'Discord Channel URL',
  'Proposed By Discord ID',
  'Accepted By Discord ID',
  'Approved By Discord ID',
  'Kind'
];

let cachedToken = null;

export async function appendApprovedScheduleToSheet(config, row) {
  if (!config.googleScheduleSheetId) {
    return { skipped: true, reason: 'GOOGLE_SCHEDULE_SHEET_ID is not configured' };
  }

  const credentials = getServiceAccountCredentials(config);
  if (!credentials) {
    return { skipped: true, reason: 'Google service account credentials are not configured' };
  }

  const accessToken = await getAccessToken(credentials);
  const sheetName = config.googleScheduleSheetTab || 'Scheduled Matches';
  await ensureScheduleHeaders(accessToken, config.googleScheduleSheetId, sheetName);

  const range = `${escapeSheetName(sheetName)}!A:Q`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.googleScheduleSheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      values: [[
        row.approvedAt,
        row.matchName,
        row.teamA,
        row.teamB,
        row.stage,
        row.round,
        row.group,
        row.scheduledAt,
        row.scheduledAtIso,
        row.timezone,
        row.faceitUrl,
        row.discordChannelId,
        row.discordChannelUrl,
        row.proposedBy,
        row.acceptedBy,
        row.approvedBy,
        row.kind
      ]]
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Google Sheets append failed: ${response.status} ${body}`);
  }

  return { skipped: false };
}

async function ensureScheduleHeaders(accessToken, spreadsheetId, sheetName) {
  const headerRange = `${escapeSheetName(sheetName)}!A1:Q1`;
  const getUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(headerRange)}`;
  const current = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!current.ok) {
    const body = await current.text().catch(() => '');
    throw new Error(`Google Sheets header check failed: ${current.status} ${body}`);
  }

  const currentBody = await current.json();
  if (currentBody.values?.[0]?.length) return;

  const updateUrl = `${getUrl}?valueInputOption=USER_ENTERED`;
  const updated = await fetch(updateUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ values: [SCHEDULE_HEADERS] })
  });

  if (!updated.ok) {
    const body = await updated.text().catch(() => '');
    throw new Error(`Google Sheets header update failed: ${updated.status} ${body}`);
  }
}

function getServiceAccountCredentials(config) {
  const raw = config.googleServiceAccountJson ||
    decodeBase64(config.googleServiceAccountJsonBase64);
  if (!raw) return null;

  const credentials = JSON.parse(raw);
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('Google service account JSON is missing client_email or private_key');
  }
  return credentials;
}

function decodeBase64(value) {
  if (!value) return null;
  return Buffer.from(value, 'base64').toString('utf8');
}

async function getAccessToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.clientEmail === credentials.client_email && cachedToken.expiresAt > now + 60) {
    return cachedToken.accessToken;
  }

  const assertion = signJwt(credentials, now);
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Google token request failed: ${response.status} ${JSON.stringify(body)}`);
  }

  cachedToken = {
    clientEmail: credentials.client_email,
    accessToken: body.access_token,
    expiresAt: now + Number(body.expires_in || 3600)
  };
  return cachedToken.accessToken;
}

function signJwt(credentials, now) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: credentials.client_email,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now
  };

  const input = `${base64UrlJson(header)}.${base64UrlJson(claim)}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(input);
  signer.end();
  const signature = signer.sign(credentials.private_key, 'base64url');
  return `${input}.${signature}`;
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function escapeSheetName(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}
