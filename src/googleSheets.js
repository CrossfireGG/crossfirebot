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
  const sheetName = await resolveScheduleSheetName(accessToken, config);
  await ensureScheduleHeaders(accessToken, config.googleScheduleSheetId, sheetName);

  const existingRows = await readScheduleRows(accessToken, config.googleScheduleSheetId, sheetName);
  const nextRows = upsertAndSortScheduleRows(existingRows, row);

  await clearScheduleRows(accessToken, config.googleScheduleSheetId, sheetName);
  if (!nextRows.length) {
    return { skipped: false, rows: 0 };
  }

  const range = `${escapeSheetName(sheetName)}!A2:Q${nextRows.length + 1}`;
  const url = `${valuesUrl(config.googleScheduleSheetId, range)}?valueInputOption=USER_ENTERED`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      values: nextRows
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Google Sheets schedule update failed: ${response.status} ${body}`);
  }

  return { skipped: false, rows: nextRows.length };
}

async function ensureScheduleHeaders(accessToken, spreadsheetId, sheetName) {
  const headerRange = `${escapeSheetName(sheetName)}!A1:Q1`;
  const getUrl = valuesUrl(spreadsheetId, headerRange);
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

async function resolveScheduleSheetName(accessToken, config) {
  if (config.googleScheduleSheetGid) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.googleScheduleSheetId)}?fields=sheets.properties`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Google Sheets tab lookup failed: ${response.status} ${body}`);
    }

    const body = await response.json();
    const sheet = body.sheets?.find((candidate) =>
      String(candidate.properties?.sheetId) === String(config.googleScheduleSheetGid)
    );
    if (sheet?.properties?.title) return sheet.properties.title;
  }

  return config.googleScheduleSheetTab || 'Scheduled Matches';
}

async function readScheduleRows(accessToken, spreadsheetId, sheetName) {
  const range = `${escapeSheetName(sheetName)}!A2:Q`;
  const response = await fetch(valuesUrl(spreadsheetId, range), {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Google Sheets schedule read failed: ${response.status} ${body}`);
  }

  const body = await response.json();
  return body.values || [];
}

async function clearScheduleRows(accessToken, spreadsheetId, sheetName) {
  const range = `${escapeSheetName(sheetName)}!A2:Q`;
  const response = await fetch(`${valuesUrl(spreadsheetId, range)}:clear`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Google Sheets schedule clear failed: ${response.status} ${body}`);
  }
}

export function upsertAndSortScheduleRows(existingRows, row) {
  const nextRow = scheduleRowValues(row);
  const shouldReplaceExisting = normalizeCell(row.kind) === 'reschedule';
  return [
    ...existingRows.filter((existingRow) =>
      !shouldReplaceExisting || !isSameScheduledMatchRow(existingRow, nextRow)
    ),
    nextRow
  ]
    .filter((existingRow) => existingRow.some((value) => String(value || '').trim()))
    .sort(compareScheduleRows);
}

function scheduleRowValues(row) {
  return [
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
  ];
}

function isSameScheduledMatchRow(existingRow, nextRow) {
  const existingFaceitUrl = normalizeCell(existingRow[10]);
  const nextFaceitUrl = normalizeCell(nextRow[10]);
  if (existingFaceitUrl && nextFaceitUrl && existingFaceitUrl === nextFaceitUrl) return true;

  const existingChannelId = normalizeCell(existingRow[11]);
  const nextChannelId = normalizeCell(nextRow[11]);
  if (existingChannelId && nextChannelId && existingChannelId === nextChannelId) return true;

  const existingMatch = normalizeCell(existingRow[1]);
  const nextMatch = normalizeCell(nextRow[1]);
  return Boolean(existingMatch && nextMatch && existingMatch === nextMatch);
}

function compareScheduleRows(left, right) {
  const leftTime = sortableScheduleTime(left);
  const rightTime = sortableScheduleTime(right);
  if (leftTime !== rightTime) return leftTime - rightTime;
  return String(left[1] || '').localeCompare(String(right[1] || ''));
}

function sortableScheduleTime(row) {
  const isoTime = Date.parse(row[8] || '');
  if (Number.isFinite(isoTime)) return isoTime;

  const displayTime = Date.parse(row[7] || '');
  return Number.isFinite(displayTime) ? displayTime : Number.MAX_SAFE_INTEGER;
}

function normalizeCell(value) {
  return String(value || '').trim().toLowerCase();
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

function valuesUrl(spreadsheetId, range) {
  return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
}
