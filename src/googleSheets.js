import crypto from 'node:crypto';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const SCHEDULE_HEADERS = [
  'TIME',
  'TEAM 1',
  'TEAM 2',
  'FACEIT LINK',
  'ROUND',
  'GROUP:'
];
const SCHEDULE_COLUMN_COUNT = SCHEDULE_HEADERS.length;

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
  const nextRows = buildScheduleSheetRows(existingRows, row, config.defaultTimezone);

  await clearScheduleRows(accessToken, config.googleScheduleSheetId, sheetName);
  if (!nextRows.length) {
    return { skipped: false, rows: 0 };
  }

  const range = `${escapeSheetName(sheetName)}!A2:F${nextRows.length + 1}`;
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
  const headerRange = `${escapeSheetName(sheetName)}!A1:F1`;
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

  return config.googleScheduleSheetTab || 'Game Schedule';
}

async function readScheduleRows(accessToken, spreadsheetId, sheetName) {
  const range = `${escapeSheetName(sheetName)}!A2:F`;
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
  const range = `${escapeSheetName(sheetName)}!A2:F`;
  const response = await fetch(`${valuesUrl(spreadsheetId, range)}:clear`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Google Sheets schedule clear failed: ${response.status} ${body}`);
  }
}

export function buildScheduleSheetRows(existingRows, row, timezone = 'America/New_York') {
  const nextEntry = scheduleEntry(row, timezone);
  const entries = [
    ...parseScheduleSheetRows(existingRows).filter((entry) => !isSameScheduledMatch(entry, nextEntry)),
    nextEntry
  ].sort(compareScheduleEntries);

  return groupScheduleEntriesByDate(entries);
}

export function upsertAndSortScheduleRows(existingRows, row) {
  return buildScheduleSheetRows(existingRows, row);
}

function parseScheduleSheetRows(rows) {
  const entries = [];
  let currentDateLabel = '';

  for (const row of rows) {
    const cells = padRow(row);
    if (isBlankRow(cells) || isScheduleHeaderRow(cells)) continue;

    if (isDateSectionRow(cells)) {
      currentDateLabel = String(cells[0] || '').trim();
      continue;
    }

    if (!cells[0] || !cells[1] || !cells[2]) continue;

    const scheduledAtIso = parseExistingScheduleTime(currentDateLabel, cells[0]);
    entries.push({
      dateLabel: currentDateLabel || dateLabelFromIso(scheduledAtIso),
      timeLabel: String(cells[0] || '').trim(),
      teamA: String(cells[1] || '').trim(),
      teamB: String(cells[2] || '').trim(),
      faceitUrl: String(cells[3] || '').trim(),
      round: String(cells[4] || '').trim(),
      group: String(cells[5] || '').trim(),
      scheduledAtIso,
      matchKey: matchKeyFromValues(cells[3], cells[1], cells[2])
    });
  }

  return entries;
}

function scheduleEntry(row, timezone) {
  const scheduledAtIso = row.scheduledAtIso || parseExistingScheduleTime('', row.scheduledAt);
  return {
    dateLabel: dateLabelFromIso(scheduledAtIso, timezone),
    timeLabel: timeLabelFromIso(scheduledAtIso, timezone) || row.scheduledAt || '',
    teamA: formatTeamScore(row.teamA, row.teamAScore),
    teamB: formatTeamScore(row.teamB, row.teamBScore),
    faceitUrl: row.faceitUrl || '',
    round: row.round || '',
    group: row.group || '',
    scheduledAtIso,
    matchKey: matchKeyFromValues(row.faceitUrl, row.teamA, row.teamB)
  };
}

function groupScheduleEntriesByDate(entries) {
  const rows = [];
  let currentDateLabel = null;

  for (const entry of entries) {
    if (entry.dateLabel !== currentDateLabel) {
      if (rows.length) rows.push(blankScheduleRow());
      currentDateLabel = entry.dateLabel;
      rows.push([entry.dateLabel, '', '', '', '', '']);
    }

    rows.push([
      entry.timeLabel,
      entry.teamA,
      entry.teamB,
      entry.faceitUrl,
      entry.round,
      entry.group
    ]);
  }

  return rows;
}

function compareScheduleEntries(left, right) {
  const leftTime = Date.parse(left.scheduledAtIso || '');
  const rightTime = Date.parse(right.scheduledAtIso || '');
  const normalizedLeft = Number.isFinite(leftTime) ? leftTime : Number.MAX_SAFE_INTEGER;
  const normalizedRight = Number.isFinite(rightTime) ? rightTime : Number.MAX_SAFE_INTEGER;
  if (normalizedLeft !== normalizedRight) return normalizedLeft - normalizedRight;
  return `${left.teamA} ${left.teamB}`.localeCompare(`${right.teamA} ${right.teamB}`);
}

function isSameScheduledMatch(left, right) {
  return Boolean(left.matchKey && right.matchKey && left.matchKey === right.matchKey);
}

function matchKeyFromValues(faceitUrl, teamA, teamB) {
  const normalizedFaceitUrl = normalizeCell(faceitUrl);
  if (normalizedFaceitUrl) return `faceit:${normalizedFaceitUrl}`;
  return `teams:${normalizeTeamCell(teamA)}:${normalizeTeamCell(teamB)}`;
}

function formatTeamScore(teamName, score) {
  return Number.isInteger(score) ? `${teamName} (${score})` : teamName;
}

function parseExistingScheduleTime(dateLabel, timeLabel) {
  const combined = [dateLabel, timeLabel].filter(Boolean).join(' ');
  const parsed = Date.parse(combined);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function dateLabelFromIso(value, timezone = 'America/New_York') {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unscheduled Date';

  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

function timeLabelFromIso(value, timezone = 'America/New_York') {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(date);
}

function isDateSectionRow(row) {
  return Boolean(row[0] && row.slice(1).every((value) => !String(value || '').trim()));
}

function isScheduleHeaderRow(row) {
  return normalizeCell(row[0]) === 'time' &&
    normalizeCell(row[1]) === 'team 1' &&
    normalizeCell(row[2]) === 'team 2';
}

function isBlankRow(row) {
  return row.every((value) => !String(value || '').trim());
}

function padRow(row) {
  return Array.from({ length: SCHEDULE_COLUMN_COUNT }, (_, index) => row[index] || '');
}

function blankScheduleRow() {
  return Array.from({ length: SCHEDULE_COLUMN_COUNT }, () => '');
}

function normalizeCell(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeTeamCell(value) {
  return normalizeCell(value).replace(/\s*\(\d+\)\s*$/g, '');
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
