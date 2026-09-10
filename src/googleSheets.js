import crypto from 'node:crypto';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const SCHEDULE_HEADERS = [
  '',
  'TIME',
  'TEAM 1',
  'TEAM 2',
  'FACEIT LINK',
  'ROUND',
  'GROUP',
  'Admin',
  'Team 1 Score',
  'Team 2 Score'
];
const SCHEDULE_COLUMN_COUNT = SCHEDULE_HEADERS.length;
const MATCH_CELL_START = 1;
const MATCH_CELL_END = 10;

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
  const sheet = await resolveScheduleSheet(accessToken, config);
  await ensureScheduleHeaders(accessToken, config.googleScheduleSheetId, sheet.title);

  const existingRows = await readScheduleGrid(accessToken, config.googleScheduleSheetId, sheet.title);
  const plan = planScheduleSheetUpdate(existingRows, row, config.defaultTimezone);

  if (plan.clearRanges.length) {
    await clearRanges(accessToken, config.googleScheduleSheetId, sheet.title, plan.clearRanges);
  }

  if (plan.insertBeforeRowNumber && plan.insertBeforeRowNumber <= existingRows.length) {
    await insertSheetRow(accessToken, config.googleScheduleSheetId, sheet.sheetId, plan.insertBeforeRowNumber);
  }

  if (plan.updates.length) {
    await updateValuesBatch(accessToken, config.googleScheduleSheetId, sheet.title, plan.updates);
  }

  return {
    skipped: false,
    rows: plan.updates.length,
    targetRow: plan.targetRowNumber,
    moved: Boolean(plan.moved)
  };
}

async function ensureScheduleHeaders(accessToken, spreadsheetId, sheetName) {
  const headerRange = `${escapeSheetName(sheetName)}!A1:J1`;
  const response = await fetch(valuesUrl(spreadsheetId, headerRange), {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Google Sheets header check failed: ${response.status} ${body}`);
  }

  const current = (await response.json()).values?.[0] || [];
  const alreadyLooksRight = normalizeCell(current[1]) === 'time' &&
    normalizeCell(current[2]) === 'team 1' &&
    normalizeCell(current[3]) === 'team 2';
  if (alreadyLooksRight) return;

  const updateUrl = `${valuesUrl(spreadsheetId, headerRange)}?valueInputOption=USER_ENTERED`;
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

async function resolveScheduleSheet(accessToken, config) {
  const response = await fetch(`${spreadsheetUrl(config.googleScheduleSheetId)}?fields=sheets.properties`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Google Sheets tab lookup failed: ${response.status} ${body}`);
  }

  const body = await response.json();
  const sheets = body.sheets || [];
  const byGid = config.googleScheduleSheetGid
    ? sheets.find((candidate) => String(candidate.properties?.sheetId) === String(config.googleScheduleSheetGid))
    : null;
  const byName = sheets.find((candidate) =>
    candidate.properties?.title === (config.googleScheduleSheetTab || 'Game Schedule')
  );
  const sheet = byGid || byName || sheets[0];

  if (!sheet?.properties?.title || sheet.properties.sheetId === undefined) {
    throw new Error('Could not find the Google Sheets schedule tab');
  }

  return {
    title: sheet.properties.title,
    sheetId: sheet.properties.sheetId
  };
}

async function readScheduleGrid(accessToken, spreadsheetId, sheetName) {
  const range = `${escapeSheetName(sheetName)}!A1:J`;
  const response = await fetch(valuesUrl(spreadsheetId, range), {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Google Sheets schedule read failed: ${response.status} ${body}`);
  }

  const body = await response.json();
  return (body.values || []).map(padRow);
}

async function clearRanges(accessToken, spreadsheetId, sheetName, ranges) {
  const response = await fetch(`${spreadsheetUrl(spreadsheetId)}/values:batchClear`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ranges: ranges.map((range) => `${escapeSheetName(sheetName)}!${range}`)
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Google Sheets schedule clear failed: ${response.status} ${body}`);
  }
}

async function insertSheetRow(accessToken, spreadsheetId, sheetId, beforeRowNumber) {
  const startIndex = Math.max(1, beforeRowNumber - 1);
  const response = await fetch(batchUpdateUrl(spreadsheetId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      requests: [{
        insertDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex,
            endIndex: startIndex + 1
          },
          inheritFromBefore: true
        }
      }]
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Google Sheets row insert failed: ${response.status} ${body}`);
  }
}

async function updateValuesBatch(accessToken, spreadsheetId, sheetName, updates) {
  const response = await fetch(`${spreadsheetUrl(spreadsheetId)}/values:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: updates.map((update) => ({
        range: `${escapeSheetName(sheetName)}!${update.range}`,
        values: update.values
      }))
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Google Sheets schedule update failed: ${response.status} ${body}`);
  }
}

export function planScheduleSheetUpdate(existingRows, row, timezone = 'America/New_York') {
  const rows = existingRows.map(padRow);
  const entry = scheduleEntry(row, timezone);
  const existingIndex = rows.findIndex((candidate, index) =>
    index > 0 && isSameScheduledMatch(rowEntry(candidate), entry)
  );
  const existingRowNumber = existingIndex >= 0 ? existingIndex + 1 : null;

  if (existingIndex >= 0) {
    rows[existingIndex] = clearMatchCells(rows[existingIndex]);
  }

  let target = existingIndex >= 0 && normalizeCell(rows[existingIndex][0]) === normalizeCell(entry.dateLabel)
    ? existingRowNumber
    : findOpenRowForDate(rows, entry.dateLabel);
  let insertBeforeRowNumber = null;
  if (!target) {
    target = findInsertRowForDate(rows, entry.dateLabel);
    insertBeforeRowNumber = target <= rows.length ? target : null;
    if (insertBeforeRowNumber) {
      rows.splice(target - 1, 0, [entry.dateLabel, '', '', '', '', '', '', '', '', '']);
    } else {
      rows[target - 1] = [entry.dateLabel, '', '', '', '', '', '', '', '', ''];
    }
  }

  rows[target - 1][0] = rows[target - 1][0] || entry.dateLabel;
  rows[target - 1].splice(MATCH_CELL_START, MATCH_CELL_END - MATCH_CELL_START, ...entry.values);

  const sortedSameDayRows = sortSameDayMatchCells(rows, entry.dateLabel);
  const updates = [];
  if (!existingRows[target - 1]?.[0] || insertBeforeRowNumber) {
    updates.push({ range: `A${target}:A${target}`, values: [[entry.dateLabel]] });
  }
  updates.push(...sortedSameDayRows.map((sameDayRow) => ({
    range: `B${sameDayRow.rowNumber}:J${sameDayRow.rowNumber}`,
    values: [sameDayRow.values]
  })));

  return {
    clearRanges: existingRowNumber ? [`B${existingRowNumber}:J${existingRowNumber}`] : [],
    insertBeforeRowNumber,
    targetRowNumber: target,
    moved: Boolean(existingRowNumber && existingRowNumber !== target),
    updates: dedupeUpdates(updates),
    previewRows: rows
  };
}

export function buildScheduleSheetRows(existingRows, row, timezone = 'America/New_York') {
  return planScheduleSheetUpdate(existingRows, row, timezone).previewRows;
}

export function upsertAndSortScheduleRows(existingRows, row) {
  return buildScheduleSheetRows(existingRows, row);
}

function scheduleEntry(row, timezone) {
  const scheduledAtIso = row.scheduledAtIso || parseExistingScheduleTime('', row.scheduledAt);
  return {
    dateLabel: dateLabelFromIso(scheduledAtIso, timezone),
    values: [
      timeLabelFromIso(scheduledAtIso, timezone) || row.scheduledAt || '',
      row.teamA || '',
      row.teamB || '',
      row.faceitUrl || '',
      row.round || '',
      row.group || '',
      row.admin || row.approvedBy || '',
      formatScore(row.teamAScore),
      formatScore(row.teamBScore)
    ],
    scheduledAtIso,
    matchKey: matchKeyFromValues(row.faceitUrl, row.teamA, row.teamB)
  };
}

function rowEntry(row) {
  const cells = padRow(row);
  return {
    dateLabel: cells[0],
    values: cells.slice(1, 10),
    scheduledAtIso: parseExistingScheduleTime(cells[0], cells[1]),
    matchKey: matchKeyFromValues(cells[4], cells[2], cells[3])
  };
}

function findOpenRowForDate(rows, dateLabel) {
  const normalizedDate = normalizeCell(dateLabel);
  const row = rows.findIndex((candidate, index) =>
    index > 0 &&
    normalizeCell(candidate[0]) === normalizedDate &&
    candidate.slice(MATCH_CELL_START, MATCH_CELL_END).every((value) => !String(value || '').trim())
  );
  return row >= 0 ? row + 1 : null;
}

function findInsertRowForDate(rows, dateLabel) {
  const targetTime = Date.parse(dateLabel);
  const sameDateRows = rows
    .map((row, index) => ({ row, rowNumber: index + 1 }))
    .filter(({ row }, index) => index > 0 && normalizeCell(row[0]) === normalizeCell(dateLabel));
  if (sameDateRows.length) {
    return sameDateRows[sameDateRows.length - 1].rowNumber + 1;
  }

  if (Number.isFinite(targetTime)) {
    const later = rows
      .map((row, index) => ({ row, rowNumber: index + 1, time: Date.parse(row[0]) }))
      .find(({ rowNumber, time }) => rowNumber > 1 && Number.isFinite(time) && time > targetTime);
    if (later) return later.rowNumber;
  }

  return rows.length + 1;
}

function sortSameDayMatchCells(rows, dateLabel) {
  const dayRows = rows
    .map((row, index) => ({ rowNumber: index + 1, row }))
    .filter(({ rowNumber, row }) =>
      rowNumber > 1 &&
      normalizeCell(row[0]) === normalizeCell(dateLabel) &&
      row.slice(1, 5).some((value) => String(value || '').trim())
    );

  const sortedValues = [...dayRows]
    .map(({ row }) => row.slice(1, 10))
    .sort((left, right) => compareScheduleValues(dateLabel, left, right));

  dayRows.forEach((target, index) => {
    target.values = sortedValues[index];
    rows[target.rowNumber - 1].splice(1, 9, ...target.values);
  });
  return dayRows;
}

function compareScheduleValues(dateLabel, left, right) {
  const leftTime = Date.parse(`${dateLabel} ${left[0]}`);
  const rightTime = Date.parse(`${dateLabel} ${right[0]}`);
  const normalizedLeft = Number.isFinite(leftTime) ? leftTime : Number.MAX_SAFE_INTEGER;
  const normalizedRight = Number.isFinite(rightTime) ? rightTime : Number.MAX_SAFE_INTEGER;
  if (normalizedLeft !== normalizedRight) return normalizedLeft - normalizedRight;
  return `${left[1]} ${left[2]}`.localeCompare(`${right[1]} ${right[2]}`);
}

function clearMatchCells(row) {
  const next = padRow(row);
  next.splice(MATCH_CELL_START, MATCH_CELL_END - MATCH_CELL_START, ...Array(9).fill(''));
  return next;
}

function isSameScheduledMatch(left, right) {
  return Boolean(left.matchKey && right.matchKey && left.matchKey === right.matchKey);
}

function matchKeyFromValues(faceitUrl, teamA, teamB) {
  const normalizedFaceitUrl = normalizeFaceitUrl(faceitUrl);
  if (normalizedFaceitUrl) return `faceit:${normalizedFaceitUrl}`;
  return `teams:${normalizeTeamCell(teamA)}:${normalizeTeamCell(teamB)}`;
}

function normalizeFaceitUrl(value) {
  return normalizeCell(value).replace(/^https?:\/\/(www\.)?faceit\.com\/[^/]+\//, 'faceit/');
}

function formatScore(score) {
  return Number.isInteger(score) ? String(score) : '';
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

  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
  return `${formatted} EST`;
}

function dedupeUpdates(updates) {
  return [...new Map(updates.map((update) => [update.range, update])).values()];
}

function padRow(row) {
  return Array.from({ length: SCHEDULE_COLUMN_COUNT }, (_, index) => row?.[index] || '');
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

function spreadsheetUrl(spreadsheetId) {
  return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
}

function batchUpdateUrl(spreadsheetId) {
  return `${spreadsheetUrl(spreadsheetId)}:batchUpdate`;
}

function valuesUrl(spreadsheetId, range) {
  return `${spreadsheetUrl(spreadsheetId)}/values/${encodeURIComponent(range)}`;
}
