/**
 * CROSSFIRE schedule log — Google Apps Script web app.
 *
 * Writes confirmed match schedules into the "Game Schedules" tab of the
 * "CF Game and Staff Schedule" spreadsheet, using the same column layout as the
 * older "Game Schedule" tab:
 *
 *   A Date | B TIME | C TEAM 1 | D VS | E TEAM 2 | F FACEIT LINK | G ROUND | H GROUP:
 *   I Admin | J Team 1 Score | K Team 2 Score | L Stream Link/s | M Stats Collected? | N Key
 *   O Sort Key (hidden; ISO timestamp used to keep the tab sorted by date and time)
 *
 * The bot fills columns A–H and O. Columns I–N are left for staff and are never touched.
 * One row per match: a reschedule updates the row whose FACEIT LINK matches.
 * After every write the tab is sorted by date and time. Rows added by hand get a
 * Sort Key computed from their Date and Time cells, so they sort as well.
 *
 * Setup: paste into the Apps Script project, set SHARED_SECRET, then
 *   Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone.
 * Copy the /exec URL into Railway as SCHEDULE_SHEET_WEBHOOK_URL and the secret as
 * SCHEDULE_SHEET_SECRET. After any edit: Deploy > Manage deployments > Edit > New version.
 */

const SHARED_SECRET = 'change-me-to-a-long-random-string';
// From the spreadsheet URL: https://docs.google.com/spreadsheets/d/<THIS PART>/edit
const SPREADSHEET_ID = '1I4lcVFTOG9C1ju_50YJHVi3TCe_694_vkKCxzIXeIso';
const SHEET_NAME = 'Game Schedules';

const HEADERS = [
  '', 'TIME', 'TEAM 1', '', 'TEAM 2', 'FACEIT LINK', 'ROUND', 'GROUP:',
  'Admin', 'Team 1 Score', 'Team 2 Score', 'Stream Link/s', 'Stats Collected?', 'Key',
  'Sort Key'
];
const BOT_COLUMNS = 8; // A–H
const DATE_COLUMN = 1; // A
const TIME_COLUMN = 2; // B
const FACEIT_LINK_COLUMN = 6; // F
const SORT_KEY_COLUMN = 15; // O

// Opening the /exec URL in a browser should show "ok". Handy for checking the deployment.
function doGet() {
  return ContentService.createTextOutput('ok');
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!body.secret || body.secret !== SHARED_SECRET) {
      return reply(401, { ok: false, error: 'bad secret' });
    }
    const row = body.row || {};
    const sheet = getOrCreateSheet();
    const values = [
      row.date || '',
      row.time || '',
      row.team1 || '',
      'VS',
      row.team2 || '',
      row.faceitLink || '',
      row.round || '',
      row.group || ''
    ];
    const sortKey = row.scheduledAtIso || sortKeyFromText(row.date, row.time);

    const existingRow = row.faceitLink ? findRowByFaceitLink(sheet, row.faceitLink) : 0;
    const targetRow = existingRow || sheet.getLastRow() + 1;
    sheet.getRange(targetRow, 1, 1, BOT_COLUMNS).setValues([values]);
    sheet.getRange(targetRow, SORT_KEY_COLUMN).setValue(sortKey);

    sortByDate(sheet);
    const finalRow = row.faceitLink ? findRowByFaceitLink(sheet, row.faceitLink) : targetRow;
    return reply(200, { ok: true, row: finalRow, updated: Boolean(existingRow) });
  } catch (error) {
    return reply(500, { ok: false, error: String(error) });
  } finally {
    lock.releaseLock();
  }
}

function findRowByFaceitLink(sheet, faceitLink) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const links = sheet.getRange(2, FACEIT_LINK_COLUMN, lastRow - 1, 1).getValues();
  const wanted = String(faceitLink).trim().toLowerCase();
  for (let i = 0; i < links.length; i++) {
    if (String(links[i][0]).trim().toLowerCase() === wanted) return i + 2;
  }
  return 0;
}

// Fills in missing Sort Keys for rows people typed by hand, then sorts rows 2..last.
function sortByDate(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return;
  const lastColumn = Math.max(sheet.getLastColumn(), SORT_KEY_COLUMN);
  const data = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();

  let changed = false;
  data.forEach((cells) => {
    if (!cells[SORT_KEY_COLUMN - 1]) {
      const key = sortKeyFromText(cells[DATE_COLUMN - 1], cells[TIME_COLUMN - 1]);
      if (key) {
        cells[SORT_KEY_COLUMN - 1] = key;
        changed = true;
      }
    }
  });
  if (changed) {
    sheet.getRange(2, SORT_KEY_COLUMN, data.length, 1).setValues(data.map((cells) => [cells[SORT_KEY_COLUMN - 1]]));
  }

  sheet.getRange(2, 1, lastRow - 1, lastColumn).sort({ column: SORT_KEY_COLUMN, ascending: true });
}

// Builds an ISO-style key from cells like "Tuesday, November 3, 2026" and "9:00 PM EST".
// Falls back to the script's time zone; the key only needs to order rows, not be exact.
function sortKeyFromText(dateText, timeText) {
  if (dateText instanceof Date) return dateText.toISOString();
  const date = String(dateText || '').trim();
  if (!date) return '';
  const cleanDate = date.replace(/^[A-Za-z]+,\s*/, '');
  const cleanTime = String(timeText || '').trim().replace(/\s*(EST|EDT|ET|CST|CDT|CT|MST|MDT|MT|PST|PDT|PT|UTC|GMT)\s*$/i, '') || '12:00 AM';
  const parsed = new Date(cleanDate + ' ' + cleanTime);
  if (isNaN(parsed.getTime())) return '';
  return Utilities.formatDate(parsed, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function getOrCreateSheet() {
  const spreadsheet = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error('No spreadsheet: set SPREADSHEET_ID at the top of the script');
  }
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  if (sheet.getMaxColumns() < SORT_KEY_COLUMN) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), SORT_KEY_COLUMN - sheet.getMaxColumns());
  }
  if (!sheet.getRange(1, SORT_KEY_COLUMN).getValue()) {
    sheet.getRange(1, SORT_KEY_COLUMN).setValue('Sort Key').setFontWeight('bold');
  }
  if (!sheet.isColumnHiddenByUser(SORT_KEY_COLUMN)) {
    sheet.hideColumns(SORT_KEY_COLUMN);
  }
  return sheet;
}

// Apps Script web apps always answer HTTP 200; the real status lives in the JSON body.
function reply(status, payload) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: status, ...payload }))
    .setMimeType(ContentService.MimeType.JSON);
}
