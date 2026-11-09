/**
 * CROSSFIRE schedule log — Google Apps Script web app.
 *
 * Writes confirmed match schedules into the "Game Schedules" tab of the
 * "CF Game and Staff Schedule" spreadsheet:
 *
 *   A Date | B TIME | C TEAM 1 | D VS | E TEAM 2 | F MATCH (FACEIT link) | G ROUND | H GROUP:
 *   I STREAM | J Stats Collected? | K–N staff checkboxes
 *   O Sort Key (hidden; ISO timestamp used to keep the tab sorted by date and time)
 *
 * Two actions, picked by `action` in the POST body:
 *   "schedule" (default)  fills columns A–H and O for a match. One row per match: a
 *                         reschedule updates the row whose FACEIT LINK matches. The FACEIT
 *                         LINK cell shows the word "Link", hyperlinked to the match page.
 *   "streamLink"          appends an approved caster's stream to the STREAM cell of
 *                         the row whose FACEIT LINK matches, one per line, shown as the channel
 *                         name hyperlinked to the stream. The column is found by
 *                         its header text, so it may be moved. Casters can only request
 *                         confirmed matches, so a missing row is reported as an error.
 *   "removeStreamLink"    takes one stream URL back out of that cell (caster withdrew or
 *                         staff revoked). Other links in the cell are kept.
 *                         Both stream link actions take an optional `row.highlight`:
 *                         "main" colours the row (A–N) as a main stream game, "community" as a
 *                         community cast, "none" clears the colour. The bot works out which.
 *   "matchResult"         writes the finished match's result (e.g. "Team won 13-7 (Mirage)")
 *                         into the "Result" column of the row whose FACEIT LINK matches. The
 *                         column is found by header and created after the last column if missing.
 *   "statsCollected"      ticks the "Stats Collected?" cell of that row (a checkbox if the
 *                         cell has one, otherwise ✅) once a caster's post-cast form is in.
 *   "availability"        reads the crew availability tabs (PROD SCHEDULE, Admin Schedule) and
 *                         returns each tab's cell text and background colours (read-only). The
 *                         bot works out who is free from the legend colours and cell text.
 *   "postCastForms"       looks up which stream request IDs have a response in the
 *                         post-cast stats form's response sheet (read-only). The bot uses
 *                         this to block casters who skipped the form for their last cast.
 *
 * Everything else in columns I–N is left for staff and is never touched.
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

// Post-cast stats form responses ("CF Streams & Streamers" spreadsheet). The form has a
// required "Request ID" question that the bot pre-fills; its column appears in the
// response tab after the first submission that includes it.
const POST_CAST_SPREADSHEET_ID = '1rQGdrdrrbh94ZR_EL12uCqcQwHR6A4VR9SBDbjXGJZY';
const POST_CAST_SHEET_NAME = 'Season 7';
const POST_CAST_REQUEST_ID_HEADER = 'Request ID';

// Crew availability tabs in this spreadsheet, read by the "availability" action.
const AVAILABILITY_TABS = ['PROD SCHEDULE', 'Admin Schedule'];

const HEADERS = [
  '', 'TIME', 'TEAM 1', '', 'TEAM 2', 'MATCH', 'ROUND', 'GROUP:',
  'STREAM', 'Stats Collected?', '', '', '', '',
  'Sort Key'
];
const BOT_COLUMNS = 8; // A–H
const DATE_COLUMN = 1; // A
const TIME_COLUMN = 2; // B
const FACEIT_LINK_COLUMN = 6; // F
// Column F shows the word "Link", hyperlinked to the FACEIT match page.
const FACEIT_LINK_LABEL = 'Link';
// The stream column's header. 'STREAM' is current; 'Stream Link/s' is the older name.
const STREAM_LINK_HEADERS = ['STREAM', 'Stream Link/s'];
const DEFAULT_STREAM_LINK_COLUMN = 9; // I, used only if the header cannot be found
const SORT_KEY_COLUMN = 15; // O
const HIGHLIGHT_COLUMNS = 14; // A–N
const RESULT_HEADER = 'Result';
const STATS_COLLECTED_HEADER = 'Stats Collected?';
const DEFAULT_STATS_COLLECTED_COLUMN = 10; // J, used only if the header cannot be found
// Row colours (Google Sheets palette): CROSSFIRE main stream games cornflower blue, community
// casts orange.
const HIGHLIGHT_COLORS = { main: '#4a86e8', community: '#ff9900', none: null };

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
    const action = body.action || 'schedule';
    if (action === 'postCastForms') return lookupPostCastForms(body.requestIds || []);
    if (action === 'availability') return readAvailability();
    const sheet = getOrCreateSheet();
    if (action === 'schedule') return writeSchedule(sheet, body.row || {});
    if (action === 'streamLink') return writeStreamLink(sheet, body.row || {});
    if (action === 'removeStreamLink') return removeStreamLink(sheet, body.row || {});
    if (action === 'matchResult') return writeMatchResult(sheet, body.row || {});
    if (action === 'statsCollected') return markStatsCollected(sheet, body.row || {});
    return reply(400, { ok: false, error: 'unknown action: ' + action });
  } catch (error) {
    return reply(500, { ok: false, error: String(error) });
  } finally {
    lock.releaseLock();
  }
}

function writeSchedule(sheet, row) {
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
  setFaceitLinkCell(sheet, targetRow, row.faceitLink);
  sheet.getRange(targetRow, SORT_KEY_COLUMN).setValue(sortKey);

  sortByDate(sheet);
  const finalRow = row.faceitLink ? findRowByFaceitLink(sheet, row.faceitLink) : targetRow;
  return reply(200, { ok: true, row: finalRow, updated: Boolean(existingRow) });
}

// Appends an approved stream URL to the match's STREAM cell, one link per line.
function writeStreamLink(sheet, row) {
  const streamUrl = String(row.streamUrl || '').trim();
  if (!streamUrl) return reply(400, { ok: false, error: 'streamUrl is required' });
  if (!row.faceitLink) return reply(400, { ok: false, error: 'faceitLink is required to find the match row' });

  const targetRow = findRowByFaceitLink(sheet, row.faceitLink);
  if (!targetRow) {
    return reply(404, { ok: false, error: 'no row on the ' + SHEET_NAME + ' tab has FACEIT link ' + row.faceitLink });
  }

  const cell = sheet.getRange(targetRow, findStreamLinkColumn(sheet));
  const entries = readStreamLinks(cell);
  const alreadyThere = entries.some((entry) => sameStreamUrl(entry.url, streamUrl));
  if (!alreadyThere) entries.push({ label: '', url: streamUrl });
  writeStreamLinks(cell, entries);
  applyHighlight(sheet, targetRow, row.highlight);
  return reply(200, { ok: true, row: targetRow, duplicate: alreadyThere, links: entries.length });
}

// Removes one stream URL from the match's STREAM cell, keeping any others.
// A missing row is not an error here: there is nothing left to remove.
function removeStreamLink(sheet, row) {
  const streamUrl = String(row.streamUrl || '').trim();
  if (!streamUrl) return reply(400, { ok: false, error: 'streamUrl is required' });
  if (!row.faceitLink) return reply(400, { ok: false, error: 'faceitLink is required to find the match row' });

  const targetRow = findRowByFaceitLink(sheet, row.faceitLink);
  if (!targetRow) return reply(200, { ok: true, row: 0, removed: false, links: 0 });

  const cell = sheet.getRange(targetRow, findStreamLinkColumn(sheet));
  const entries = readStreamLinks(cell);
  const kept = entries.filter((entry) => !sameStreamUrl(entry.url, streamUrl));
  const removed = kept.length !== entries.length;
  if (removed) writeStreamLinks(cell, kept);
  applyHighlight(sheet, targetRow, row.highlight);
  return reply(200, { ok: true, row: targetRow, removed: removed, links: kept.length });
}

// --- STREAM cell: one line per stream, showing the channel name hyperlinked to it. ---

// Reads the cell back as [{ label, url }]: lines with a hyperlink, plain URLs (older rows) and
// any notes staff typed (url null, kept as they are).
function readStreamLinks(cell) {
  const rich = cell.getRichTextValue();
  const text = rich ? rich.getText() : String(cell.getValue() || '');
  const runs = rich ? rich.getRuns() : [];
  const entries = [];
  let offset = 0;
  text.split(/\r?\n/).forEach((line) => {
    const start = offset;
    const end = offset + line.length;
    offset = end + 1;
    const trimmed = line.trim();
    if (!trimmed) return;
    const run = runs.find((part) => part.getLinkUrl() && part.getStartIndex() < end && part.getEndIndex() > start);
    let url = run ? run.getLinkUrl() : null;
    if (!url && /^https?:\/\//i.test(trimmed)) url = trimmed;
    if (!url && /^(www\.)?(twitch\.tv|youtube\.com|kick\.com)\//i.test(trimmed)) url = 'https://' + trimmed;
    entries.push({ label: trimmed, url: url });
  });
  return entries;
}

// Writes the entries back, one per line: links as the channel name, hyperlinked; notes as typed.
function writeStreamLinks(cell, entries) {
  if (!entries.length) {
    cell.clearContent();
    return;
  }
  const labels = entries.map((entry) => (entry.url ? streamChannelLabel(entry.url) : entry.label));
  const builder = SpreadsheetApp.newRichTextValue().setText(labels.join('\n'));
  let offset = 0;
  entries.forEach((entry, i) => {
    if (entry.url && labels[i].length) builder.setLinkUrl(offset, offset + labels[i].length, entry.url);
    offset += labels[i].length + 1;
  });
  cell.setRichTextValue(builder.build());
}

// "https://twitch.tv/playcrossfire" -> "playcrossfire"; YouTube "@handle" -> "handle".
function streamChannelLabel(url) {
  const match = String(url || '').match(/^https?:\/\/[^\/]+\/(?:c\/|channel\/|user\/)?@?([^\/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : String(url || '');
}

function sameStreamUrl(a, b) {
  const key = (value) => String(value || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
  return Boolean(a) && Boolean(b) && key(a) === key(b);
}

// Colours the match row: main stream, community cast, or clears it ("none"). No highlight sent
// (an older bot) leaves the row alone.
function applyHighlight(sheet, targetRow, highlight) {
  if (!highlight || !(highlight in HIGHLIGHT_COLORS)) return;
  sheet.getRange(targetRow, 1, 1, HIGHLIGHT_COLUMNS).setBackground(HIGHLIGHT_COLORS[highlight]);
}

// Writes the result text into the "Result" column (created after the last column if missing).
function writeMatchResult(sheet, row) {
  const result = String(row.result || '').trim();
  if (!result) return reply(400, { ok: false, error: 'result is required' });
  if (!row.faceitLink) return reply(400, { ok: false, error: 'faceitLink is required to find the match row' });
  const targetRow = findRowByFaceitLink(sheet, row.faceitLink);
  if (!targetRow) return reply(404, { ok: false, error: 'no row on the ' + SHEET_NAME + ' tab has FACEIT link ' + row.faceitLink });
  sheet.getRange(targetRow, findOrCreateColumn(sheet, RESULT_HEADER)).setValue(result);
  return reply(200, { ok: true, row: targetRow });
}

// Ticks "Stats Collected?": checks the checkbox if the cell has one, otherwise writes ✅.
function markStatsCollected(sheet, row) {
  if (!row.faceitLink) return reply(400, { ok: false, error: 'faceitLink is required to find the match row' });
  const targetRow = findRowByFaceitLink(sheet, row.faceitLink);
  if (!targetRow) return reply(404, { ok: false, error: 'no row on the ' + SHEET_NAME + ' tab has FACEIT link ' + row.faceitLink });
  const column = findColumnByHeader(sheet, STATS_COLLECTED_HEADER) || DEFAULT_STATS_COLLECTED_COLUMN;
  const cell = sheet.getRange(targetRow, column);
  const rule = cell.getDataValidation();
  const isCheckbox = rule && rule.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.CHECKBOX;
  if (isCheckbox) {
    if (cell.isChecked()) return reply(200, { ok: true, row: targetRow, already: true });
    cell.check();
  } else {
    if (String(cell.getValue() || '').trim()) return reply(200, { ok: true, row: targetRow, already: true });
    cell.setValue('✅');
  }
  return reply(200, { ok: true, row: targetRow, already: false });
}

function findColumnByHeader(sheet, header) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) return 0;
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const wanted = String(header).trim().toLowerCase();
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim().toLowerCase() === wanted) return i + 1;
  }
  return 0;
}

function findOrCreateColumn(sheet, header) {
  const found = findColumnByHeader(sheet, header);
  if (found) return found;
  const column = Math.max(sheet.getLastColumn(), SORT_KEY_COLUMN) + 1;
  if (sheet.getMaxColumns() < column) sheet.insertColumnsAfter(sheet.getMaxColumns(), column - sheet.getMaxColumns());
  sheet.getRange(1, column).setValue(header).setFontWeight('bold');
  return column;
}

// The crew availability tabs as cell text plus background colours. Read-only. Merged cells
// (e.g. "Austin LAN" across several days) are filled in so every day carries the value.
function readAvailability() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const tabs = [];
  AVAILABILITY_TABS.forEach(function (name) {
    const sheet = spreadsheet.getSheetByName(name);
    if (!sheet) return;
    const range = sheet.getDataRange();
    const values = range.getDisplayValues();
    const backgrounds = range.getBackgrounds();
    range.getMergedRanges().forEach(function (merged) {
      const top = merged.getRow() - 1;
      const left = merged.getColumn() - 1;
      if (!values[top] || left >= values[top].length) return;
      const value = values[top][left];
      const background = backgrounds[top][left];
      for (let r = top; r < top + merged.getNumRows() && r < values.length; r++) {
        for (let c = left; c < left + merged.getNumColumns() && c < values[r].length; c++) {
          values[r][c] = value;
          backgrounds[r][c] = background;
        }
      }
    });
    tabs.push({ name: name, values: values, backgrounds: backgrounds });
  });
  return reply(200, { ok: true, tabs: tabs });
}

// Which of the given request IDs have a post-cast form response. Read-only.
// Answers { found: { "<requestId>": { submittedAt, row } } } for the ones that do.
function lookupPostCastForms(requestIds) {
  const wanted = {};
  (requestIds || []).forEach((id) => {
    const key = String(id || '').trim().toLowerCase();
    if (key) wanted[key] = String(id).trim();
  });
  const found = {};
  if (!Object.keys(wanted).length) return reply(200, { ok: true, found: found });

  const sheet = SpreadsheetApp.openById(POST_CAST_SPREADSHEET_ID).getSheetByName(POST_CAST_SHEET_NAME);
  if (!sheet) return reply(500, { ok: false, error: 'post-cast response tab "' + POST_CAST_SHEET_NAME + '" not found' });
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return reply(200, { ok: true, found: found });

  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = values[0].map((header) => String(header).trim().toLowerCase());
  const idColumn = headers.indexOf(POST_CAST_REQUEST_ID_HEADER.toLowerCase());
  if (idColumn < 0) return reply(200, { ok: true, found: found, note: 'no "' + POST_CAST_REQUEST_ID_HEADER + '" column yet' });
  const timestampColumn = headers.indexOf('timestamp');

  for (let i = 1; i < values.length; i++) {
    const key = String(values[i][idColumn] || '').trim().toLowerCase();
    if (!key || !wanted[key] || found[wanted[key]]) continue;
    const stamp = timestampColumn >= 0 ? values[i][timestampColumn] : null;
    found[wanted[key]] = {
      submittedAt: stamp instanceof Date ? stamp.toISOString() : String(stamp || ''),
      row: i + 1
    };
  }
  return reply(200, { ok: true, found: found });
}

// Looks the column up by header ("STREAM" or the older "Stream Link/s") so staff can move it;
// falls back to column I.
function findStreamLinkColumn(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), DEFAULT_STREAM_LINK_COLUMN);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const wanted = STREAM_LINK_HEADERS.map((header) => header.toLowerCase());
  for (let i = 0; i < headers.length; i++) {
    if (wanted.indexOf(String(headers[i]).trim().toLowerCase()) >= 0) return i + 1;
  }
  return DEFAULT_STREAM_LINK_COLUMN;
}

// Rows match on the FACEIT room ID when both links contain one, so a link typed by hand
// with a different language prefix or trailing slash still finds the bot's row. The cell may
// hold the URL itself, the word "Link" hyperlinked to it, or a =HYPERLINK("url", ...) formula.
function findRowByFaceitLink(sheet, faceitLink) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const wanted = faceitLinkKey(faceitLink);
  if (!wanted) return 0;
  const range = sheet.getRange(2, FACEIT_LINK_COLUMN, lastRow - 1, 1);
  const values = range.getValues();
  const rich = range.getRichTextValues();
  const formulas = range.getFormulas();
  for (let i = 0; i < values.length; i++) {
    if (faceitLinkKey(faceitLinkInCell(values[i][0], rich[i][0], formulas[i][0])) === wanted) return i + 2;
  }
  return 0;
}

function faceitLinkInCell(value, richText, formula) {
  const linked = richText && richText.getLinkUrl();
  if (linked) return linked;
  const fromFormula = String(formula || '').match(/HYPERLINK\(\s*"([^"]+)"/i);
  if (fromFormula) return fromFormula[1];
  return value;
}

// Shows the FACEIT room as the word "Link", hyperlinked to the match page.
function setFaceitLinkCell(sheet, targetRow, url) {
  const link = String(url || '').trim();
  if (!link) return;
  sheet.getRange(targetRow, FACEIT_LINK_COLUMN).setRichTextValue(
    SpreadsheetApp.newRichTextValue().setText(FACEIT_LINK_LABEL).setLinkUrl(link).build()
  );
}

// Run once by hand (select it in the editor and press Run) to tidy rows already on the sheet:
// FACEIT URLs in column F become the word "Link", and stream URLs in the STREAM column become the
// channel name, each hyperlinked to the same page. Safe to run again.
function convertLinksToLabels() {
  const sheet = getOrCreateSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const values = sheet.getRange(2, FACEIT_LINK_COLUMN, lastRow - 1, 1).getValues();
  values.forEach((cells, i) => {
    const text = String(cells[0] || '').trim();
    if (/^https?:\/\//i.test(text)) setFaceitLinkCell(sheet, i + 2, text);
  });
  const streamColumn = findStreamLinkColumn(sheet);
  for (let rowIndex = 2; rowIndex <= lastRow; rowIndex++) {
    const cell = sheet.getRange(rowIndex, streamColumn);
    const entries = readStreamLinks(cell);
    if (entries.some((entry) => entry.url)) writeStreamLinks(cell, entries);
  }
}

function faceitLinkKey(value) {
  const text = String(value || '').trim().toLowerCase();
  const room = text.match(/\/room\/(1-[0-9a-f-]{36})/);
  return room ? room[1] : text.replace(/\/+$/, '');
}

// Rebuilds Sort Keys from the displayed Date and Time on every pass, then sorts
// rows 2..last. Recomputing prevents a manually edited time from keeping a stale key.
function sortByDate(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return;
  const lastColumn = Math.max(sheet.getLastColumn(), SORT_KEY_COLUMN);
  const data = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();

  data.forEach((cells) => {
    const key = sortKeyFromText(cells[DATE_COLUMN - 1], cells[TIME_COLUMN - 1]);
    cells[SORT_KEY_COLUMN - 1] = key || '';
  });
  sheet.getRange(2, SORT_KEY_COLUMN, data.length, 1).setValues(data.map((cells) => [cells[SORT_KEY_COLUMN - 1]]));

  sheet.getRange(2, 1, lastRow - 1, lastColumn).sort({ column: SORT_KEY_COLUMN, ascending: true });
}

// Builds a timezone-free sortable key from the displayed Eastern date and time.
// This intentionally avoids mixing UTC timestamps with local timestamps, which
// can put an 8:00 PM row below a 9:00 PM row on the same date.
function sortKeyFromText(dateValue, timeValue) {
  const dateKey = dateKeyFromValue(dateValue);
  if (!dateKey) return '';
  return dateKey + 'T' + timeKeyFromValue(timeValue);
}

function dateKeyFromValue(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    const zone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    return Utilities.formatDate(value, zone, 'yyyy-MM-dd');
  }

  const text = String(value || '').trim().replace(/^[A-Za-z]+,\s*/, '');
  if (!text) return '';
  const months = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
  };
  const named = text.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (named && months[named[1].toLowerCase()]) {
    return named[3] + '-' + pad2(months[named[1].toLowerCase()]) + '-' + pad2(named[2]);
  }
  const numeric = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  return numeric ? numeric[3] + '-' + pad2(numeric[1]) + '-' + pad2(numeric[2]) : '';
}

function timeKeyFromValue(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    const zone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    return Utilities.formatDate(value, zone, 'HH:mm:ss');
  }

  const text = String(value || '').trim();
  const twelveHour = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/i);
  if (twelveHour) {
    let hour = Number(twelveHour[1]) % 12;
    if (twelveHour[3].toUpperCase() === 'PM') hour += 12;
    return pad2(hour) + ':' + pad2(twelveHour[2] || 0) + ':00';
  }
  const twentyFourHour = text.match(/^(\d{1,2}):(\d{2})/);
  return twentyFourHour
    ? pad2(twentyFourHour[1]) + ':' + pad2(twentyFourHour[2]) + ':00'
    : '00:00:00';
}

function pad2(value) {
  return String(value).padStart(2, '0');
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
