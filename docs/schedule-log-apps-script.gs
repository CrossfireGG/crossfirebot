/**
 * CROSSFIRE schedule log — Google Apps Script web app.
 *
 * Writes confirmed match schedules into the "Game Schedules" tab of the
 * "CF Game and Staff Schedule" spreadsheet:
 *
 *   A DATE & TIME | B TEAM 1 | C VS | D TEAM 2 | E MATCH (FACEIT link) | F ROUND | G GROUP:
 *   H STREAM | I Stats Collected? | J–M staff checkboxes
 *
 * Column A holds a real date-and-time value (Eastern), shown as "Thu, Nov 12 · 9:30 PM ET", so the
 * tab sorts by it directly. Staff adding a row by hand can type e.g. "11/12/2026 9:30 PM" there.
 * Sheets set up with separate Date and TIME columns are converted once with combineDateAndTime()
 * (run it from the editor; it makes a backup copy of the tab first). Until then the web app
 * refuses to write, so the old layout is never written in the new shape.
 *
 * Actions, picked by `action` in the POST body:
 *   "schedule" (default)  fills columns A–G for a match. One row per match: a
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
 *                         "main" colours the row (A–M) as a main stream game, "community" as a
 *                         community cast, "none" clears the colour. The bot works out which.
 *   "matchResult"         writes the finished match's result (e.g. "Team won 13-7 (Mirage)")
 *                         into the "Result" column of the row whose FACEIT LINK matches. The
 *                         column is found by header and created after the last column if missing.
 *   "statsCollected"      ticks the "Stats Collected?" cell of that row (a checkbox if the
 *                         cell has one, otherwise ✅) once a caster's post-cast form is in.
 *   "availability"        reads the crew availability tabs (PROD SCHEDULE, Admin Schedule) and
 *                         returns each tab's cell text and background colours (read-only). The
 *                         bot works out who is free from the legend colours and cell text.
 *   "teamInfo"            reads the "Team Info" tab (read-only): every cell's text and the link
 *                         behind it (the HLTV / Liquipedia labels are links). Used in prep packs.
 *   "teamInfoUpdate"      writes one team's row on the "Team Info" tab (/crossfire teamnotes):
 *                         finds the row by team name (or adds one) and sets the given columns,
 *                         adding a column header if it is missing. Links are written as a label
 *                         ("HLTV") hyperlinked to the URL, like the rest of the tab.
 *   "postCastForms"       looks up which stream request IDs have a response in the
 *                         post-cast stats form's response sheet (read-only). The bot uses
 *                         this to block casters who skipped the form for their last cast.
 *   "casterApplications"  reads the Streaming Application form's response tab (read-only):
 *                         the header row and every row after `afterRow`. Without `afterRow`
 *                         it only returns where the tab ends, so the bot starts from there.
 *                         The bot posts each new application in the stream request channel.
 *   "rosterTeam"          reads one team's block on the roster tab (read-only): the
 *                         spreadsheet and tab come from the bot (`spreadsheetId`, `sheetName`).
 *                         Finds the team by FACEIT team ID (its Team Info FACEIT link), name, or
 *                         its captain (Discord username or IGN in the Captain cell).
 *   "rosterChange"        writes a /roster-change: the new player into the target slot (the old
 *                         player moved to the first empty sub slot first when `mode` is "sub"),
 *                         plus a line in a "CHANGES" column if the tab has one. Refuses if the
 *                         slot changed since the captain read it.
 *
 * Everything else in columns H–M is left for staff and is never touched.
 * After every write the tab is sorted by column A (date and time).
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

// Streaming Application form responses: the same spreadsheet, the tab with this gid (the number
// after "gid=" in its URL), so renaming the tab doesn't break it.
const APPLICATION_SPREADSHEET_ID = '1rQGdrdrrbh94ZR_EL12uCqcQwHR6A4VR9SBDbjXGJZY';
const APPLICATION_SHEET_GID = 37125937;
const APPLICATION_MAX_ROWS = 25;
const POST_CAST_REQUEST_ID_HEADER = 'Request ID';

// Crew availability tabs in this spreadsheet, read by the "availability" action.
const AVAILABILITY_TABS = ['PROD SCHEDULE', 'Admin Schedule'];
// Team links and notes for caster prep packs.
const TEAM_INFO_TAB = 'Team Info';

const DATE_TIME_HEADER = 'DATE & TIME';
const HEADERS = [
  DATE_TIME_HEADER, 'TEAM 1', '', 'TEAM 2', 'MATCH', 'ROUND', 'GROUP:',
  'STREAM', 'Stats Collected?', '', '', '', ''
];
const BOT_COLUMNS = 7; // A–G
const DATE_TIME_COLUMN = 1; // A
// How column A shows the date and time, e.g. "Thu, Nov 12 · 9:30 PM ET".
const DATE_TIME_FORMAT = 'ddd, mmm d "·" h:mm AM/PM "ET"';
// Match times are Eastern.
const SCHEDULE_TIME_ZONE = 'America/New_York';
const FACEIT_LINK_COLUMN = 5; // E
// Column E shows the word "Link", hyperlinked to the FACEIT match page.
const FACEIT_LINK_LABEL = 'Link';
// The stream column's header. 'STREAM' is current; 'Stream Link/s' is the older name.
const STREAM_LINK_HEADERS = ['STREAM', 'Stream Link/s'];
const DEFAULT_STREAM_LINK_COLUMN = 8; // H, used only if the header cannot be found
const HIGHLIGHT_COLUMNS = 13; // A–M
const RESULT_HEADER = 'Result';
const STATS_COLLECTED_HEADER = 'Stats Collected?';
const DEFAULT_STATS_COLLECTED_COLUMN = 9; // I, used only if the header cannot be found
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
    if (action === 'casterApplications') return readCasterApplications(body.afterRow);
    if (action === 'rosterTeam') return readRosterTeam(body);
    if (action === 'rosterChange') return writeRosterChange(body);
    if (action === 'availability') return readAvailability();
    if (action === 'teamInfo') return readTeamInfo();
    if (action === 'teamInfoUpdate') return updateTeamInfo(body.team, body.fields || {});
    const sheet = getOrCreateSheet();
    if (hasSeparateTimeColumn(sheet)) {
      return reply(409, { ok: false, error: 'the ' + SHEET_NAME + ' tab still has separate Date and TIME columns: run combineDateAndTime once in the Apps Script editor' });
    }
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
    scheduleCellValue(sheet, row),
    row.team1 || '',
    'VS',
    row.team2 || '',
    row.faceitLink || '',
    row.round || '',
    row.group || ''
  ];

  const existingRow = row.faceitLink ? findRowByFaceitLink(sheet, row.faceitLink) : 0;
  const targetRow = existingRow || sheet.getLastRow() + 1;
  sheet.getRange(targetRow, 1, 1, BOT_COLUMNS).setValues([values]);
  sheet.getRange(targetRow, DATE_TIME_COLUMN).setNumberFormat(DATE_TIME_FORMAT);
  setFaceitLinkCell(sheet, targetRow, row.faceitLink);

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
  const column = Math.max(sheet.getLastColumn(), HIGHLIGHT_COLUMNS) + 1;
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

// --- Team Info tab ---------------------------------------------------------------------

function teamInfoSheet(create) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = spreadsheet.getSheets().filter(function (tab) {
    return tab.getName().trim().toLowerCase() === TEAM_INFO_TAB.toLowerCase();
  })[0] || null;
  if (!sheet && create) {
    sheet = spreadsheet.insertSheet(TEAM_INFO_TAB);
    sheet.getRange(1, 1, 1, 3).setValues([['Name', 'HLTV', 'Liquipedia']]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function cellLink(rich) {
  if (!rich) return null;
  const direct = rich.getLinkUrl();
  if (direct) return direct;
  const run = rich.getRuns().filter(function (part) { return part.getLinkUrl(); })[0];
  return run ? run.getLinkUrl() : null;
}

function readTeamInfo() {
  const sheet = teamInfoSheet(false);
  if (!sheet || sheet.getLastRow() < 1) return reply(200, { ok: true, rows: [] });
  const range = sheet.getDataRange();
  const values = range.getDisplayValues();
  const rich = range.getRichTextValues();
  const formulas = range.getFormulas();
  const rows = values.map(function (row, r) {
    return row.map(function (text, c) {
      // A link inserted on the text, or a =HYPERLINK("url", "label") formula.
      const fromFormula = String(formulas[r][c] || '').match(/HYPERLINK\(\s*"([^"]+)"/i);
      return { text: text, link: cellLink(rich[r][c]) || (fromFormula ? fromFormula[1] : null) };
    });
  });
  return reply(200, { ok: true, rows: rows });
}

// Same matching as the bot: "Celestial" matches "Celestial Esports".
function teamInfoKey(name) {
  return String(name || '').toLowerCase().replace(/\b(e-?sports?|gaming|team|club|gg|cs2?|org)\b/g, ' ').replace(/[^a-z0-9]+/g, '');
}

// fields: { "<Column header>": { text } | { link, label } | { clear: true } }
function updateTeamInfo(team, fields) {
  const name = String(team || '').trim();
  if (!name) return reply(400, { ok: false, error: 'team is required' });
  const sheet = teamInfoSheet(true);
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0].map(function (header) { return String(header).trim(); });
  let nameColumn = 0;
  headers.forEach(function (header, index) { if (!nameColumn && /^(name|team|team name)$/i.test(header)) nameColumn = index + 1; });
  if (!nameColumn) nameColumn = 1;
  const key = teamInfoKey(name);
  const lastRow = sheet.getLastRow();
  let targetRow = 0;
  let best = 0;
  if (lastRow >= 2) {
    sheet.getRange(2, nameColumn, lastRow - 1, 1).getDisplayValues().forEach(function (cells, index) {
      const other = teamInfoKey(cells[0]);
      if (!other) return;
      const score = other === key ? 1000
        : (other.length >= 4 && key.length >= 4 && (key.indexOf(other) === 0 || other.indexOf(key) === 0)) ? Math.min(other.length, key.length) : 0;
      if (score > best) { best = score; targetRow = index + 2; }
    });
  }
  const created = !targetRow;
  if (!targetRow) {
    targetRow = lastRow + 1;
    sheet.getRange(targetRow, nameColumn).setValue(name);
  }
  Object.keys(fields || {}).forEach(function (header) {
    const field = fields[header] || {};
    let column = 0;
    headers.forEach(function (existing, index) { if (!column && existing.toLowerCase() === header.toLowerCase()) column = index + 1; });
    if (!column) {
      column = sheet.getLastColumn() + 1;
      sheet.getRange(1, column).setValue(header).setFontWeight('bold');
      headers[column - 1] = header;
    }
    const cell = sheet.getRange(targetRow, column);
    if (field.clear) cell.clearContent();
    else if (field.link) cell.setRichTextValue(SpreadsheetApp.newRichTextValue().setText(field.label || header).setLinkUrl(field.link).build());
    else cell.setValue(String(field.text || ''));
  });
  return reply(200, { ok: true, row: targetRow, created: created });
}

// Which of the given request IDs have a post-cast form response. Read-only.
// Answers { found: { "<requestId>": { submittedAt, row } } } for the ones that do.
function readCasterApplications(afterRow) {
  const sheet = SpreadsheetApp.openById(APPLICATION_SPREADSHEET_ID).getSheets()
    .filter((tab) => tab.getSheetId() === APPLICATION_SHEET_GID)[0];
  if (!sheet) return reply(500, { ok: false, error: 'application tab with gid ' + APPLICATION_SHEET_GID + ' not found' });
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastColumn < 1 || lastRow < 1) return reply(200, { ok: true, lastRow: lastRow, headers: [], rows: [] });
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map((header) => String(header));
  const from = Number(afterRow);
  if (!Number.isInteger(from) || from < 1) return reply(200, { ok: true, lastRow: lastRow, headers: headers, rows: [] });
  const first = from + 1;
  const count = Math.min(lastRow - from, APPLICATION_MAX_ROWS);
  if (count <= 0) return reply(200, { ok: true, lastRow: lastRow, headers: headers, rows: [] });
  const values = sheet.getRange(first, 1, count, lastColumn).getValues();
  const rows = values.map((row, index) => ({
    row: first + index,
    values: row.map((cell) => (cell instanceof Date ? cell.toISOString() : String(cell)))
  }));
  return reply(200, { ok: true, lastRow: lastRow, headers: headers, rows: rows });
}

// ---- Roster tab (/roster-change) ----
// "Roster Tracking" tab: each team is an 11-row block.
//   row 1: (blank) | Team | Captian | Twitter | FACEIT | HLTV | VRS | Abbreviation | Logo
//   row 2: "Team Info" | team name | captain | X | FACEIT team link | HLTV | VRS | abbreviation | logo
//   row 3: "Player Info" | IGN | Discord | Twitter | FACEIT | HLTV | Nationality | SteamID64 | Full Name
//   rows 4-11: Starter 1-5, Sub 1-2, Coach, with the player columns of row 3 (B-I).
// The team is found by its FACEIT team link, its name, or its captain (Discord username or IGN).
// A change log line is only written if row 1 has a column headed "CHANGES".
const ROSTER_FIELDS = ['alias', 'discord', 'twitter', 'faceit', 'hltv', 'nationality', 'steamId', 'fullName'];
// Written as hyperlinks: the bot's label ("…" by default, like the tab) with the URL behind it.
const ROSTER_LINK_FIELDS = ['twitter', 'faceit', 'hltv'];
const ROSTER_FIRST_FIELD_COLUMN = 2; // B
const ROSTER_SLOT_ROWS = 8; // Starter 1-5, Sub 1-2, Coach

function rosterSheet(body) {
  if (!body.spreadsheetId || !body.sheetName) return null;
  return SpreadsheetApp.openById(body.spreadsheetId).getSheetByName(body.sheetName);
}

function rosterKey(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function rosterTeamId(url) {
  const match = String(url || '').match(/(?:team-home|teams)\/([0-9a-f-]{36})/i);
  return match ? match[1].toLowerCase() : '';
}

function readRosterBlocks(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return [];
  const width = ROSTER_FIRST_FIELD_COLUMN + ROSTER_FIELDS.length - 1;
  const values = sheet.getRange(1, 1, lastRow, width).getValues();
  // The team FACEIT cell shows "faceit.com/..." with the real link behind it: read the link.
  const linkRange = sheet.getRange(1, 5, lastRow, 1);
  const links = typeof linkRange.getRichTextValues === 'function' ? linkRange.getRichTextValues() : [];
  const linkAt = (i) => {
    const rich = links[i] && links[i][0];
    return (rich && typeof rich.getLinkUrl === 'function' && rich.getLinkUrl()) || '';
  };
  const blocks = [];
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim().toLowerCase() !== 'team info') continue;
    const slots = [];
    for (let k = 2; k < 2 + ROSTER_SLOT_ROWS && i + k < values.length; k++) {
      const row = values[i + k];
      const label = String(row[0]).trim().replace(/:$/, '');
      if (!/^(starter|sub|coach)/i.test(label)) continue;
      const slot = { label: label, row: i + k + 1 };
      ROSTER_FIELDS.forEach((field, index) => { slot[field] = String(row[ROSTER_FIRST_FIELD_COLUMN - 1 + index]).trim(); });
      slots.push(slot);
    }
    blocks.push({
      teamName: String(values[i][1]).trim(),
      captain: String(values[i][2]).trim(),
      faceitUrl: linkAt(i) || String(values[i][4]).trim(),
      headerRow: i + 1, // the "Team Info" row
      slots: slots
    });
  }
  return blocks;
}

// The captain cell may hold a Discord username or an IGN.
function isRosterCaptain(block, username) {
  const who = String(username || '').replace(/^@/, '').trim().toLowerCase();
  const captain = String(block.captain || '').replace(/^@/, '').trim().toLowerCase();
  if (!who || !captain) return false;
  if (captain === who) return true;
  return block.slots.some((slot) => String(slot.discord).replace(/^@/, '').trim().toLowerCase() === who
    && String(slot.alias).trim().toLowerCase() === captain);
}

function readRosterTeam(body) {
  const sheet = rosterSheet(body);
  if (!sheet) return reply(500, { ok: false, error: 'roster tab "' + body.sheetName + '" not found' });
  const blocks = readRosterBlocks(sheet);
  const id = String(body.faceitTeamId || '').toLowerCase();
  const name = rosterKey(body.teamName);
  let team = null;
  if (id) team = blocks.filter((block) => rosterTeamId(block.faceitUrl) === id)[0] || null;
  if (!team && name) team = blocks.filter((block) => rosterKey(block.teamName) === name)[0] || null;
  if (!team && body.captainDiscord) team = blocks.filter((block) => isRosterCaptain(block, body.captainDiscord))[0] || null;
  if (team) team.isCaptain = Boolean(body.captainDiscord) && isRosterCaptain(team, body.captainDiscord);
  return reply(200, { ok: true, team: team });
}

function writeRosterChange(body) {
  const sheet = rosterSheet(body);
  if (!sheet) return reply(500, { ok: false, error: 'roster tab "' + body.sheetName + '" not found' });
  const headerRow = Number(body.headerRow);
  const targetRow = Number(body.targetRow);
  const player = body.player || {};
  if (!Number.isInteger(headerRow) || !Number.isInteger(targetRow)) return reply(400, { ok: false, error: 'headerRow and targetRow are required' });
  const block = readRosterBlocks(sheet).filter((entry) => entry.headerRow === headerRow)[0];
  if (!block || rosterKey(block.teamName) !== rosterKey(body.teamName)) {
    return reply(409, { ok: false, error: 'the team block moved on the sheet; run /roster-change again' });
  }
  const target = block.slots.filter((slot) => slot.row === targetRow)[0];
  if (!target || /^coach/i.test(target.label)) return reply(409, { ok: false, error: 'that slot is not a starter or sub slot of ' + block.teamName });
  if (rosterKey(target.alias) !== rosterKey(body.expectedAlias)) {
    return reply(409, { ok: false, error: target.label + ' changed on the sheet since you opened it; run /roster-change again' });
  }
  const width = ROSTER_FIELDS.length;
  let movedTo = null;
  if (body.mode === 'sub') {
    const free = block.slots.filter((slot) => /^sub/i.test(slot.label) && !String(slot.alias).trim() && !String(slot.fullName).trim())[0];
    if (!free) return reply(409, { ok: false, error: 'both sub slots are full' });
    // copyTo keeps the moved player's hyperlinks (setValues would keep only the labels).
    sheet.getRange(targetRow, ROSTER_FIRST_FIELD_COLUMN, 1, width).copyTo(sheet.getRange(free.row, ROSTER_FIRST_FIELD_COLUMN, 1, width));
    movedTo = free.label;
  }
  sheet.getRange(targetRow, ROSTER_FIRST_FIELD_COLUMN, 1, width).setValues([ROSTER_FIELDS.map((field) => String(player[field] || ''))]);
  const linkLabel = String(body.linkLabel || '…');
  ROSTER_LINK_FIELDS.forEach((field) => {
    const url = String(player[field] || '').trim();
    if (!/^https?:\/\//i.test(url)) return;
    const link = SpreadsheetApp.newRichTextValue().setText(linkLabel).setLinkUrl(url).build();
    sheet.getRange(targetRow, ROSTER_FIRST_FIELD_COLUMN + ROSTER_FIELDS.indexOf(field)).setRichTextValue(link);
  });
  const changesColumn = body.logLine ? findColumnByHeaderContaining(sheet, 'changes') : 0;
  if (changesColumn) {
    // Under the last line of the CHANGES log.
    const last = Math.max(sheet.getLastRow(), 2);
    const log = sheet.getRange(2, changesColumn, last - 1, 1).getValues();
    let at = 2;
    for (let i = log.length - 1; i >= 0; i--) {
      if (String(log[i][0]).trim()) { at = i + 3; break; }
    }
    sheet.getRange(at, changesColumn).setValue(String(body.logLine));
  }
  return reply(200, { ok: true, row: targetRow, movedTo: movedTo, logged: Boolean(changesColumn) });
}

function findColumnByHeaderContaining(sheet, text) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) return 0;
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i]).toLowerCase().indexOf(text) >= 0) return i + 1;
  }
  return 0;
}

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
// falls back to column H.
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
// FACEIT URLs in the MATCH column become the word "Link", and stream URLs in the STREAM column become the
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

// Column A as a real date-time value: the match's Eastern wall-clock time, stored in the
// spreadsheet's own time zone so it displays exactly that. Free-text schedules stay text.
function scheduleCellValue(sheet, row) {
  if (row.scheduledAtIso) {
    const instant = new Date(row.scheduledAtIso);
    if (!isNaN(instant.getTime())) {
      const wallClock = Utilities.formatDate(instant, SCHEDULE_TIME_ZONE, 'yyyy-MM-dd HH:mm:ss');
      return Utilities.parseDate(wallClock, sheetTimeZone(sheet), 'yyyy-MM-dd HH:mm:ss');
    }
  }
  return [row.date, row.time].filter(Boolean).join(' ');
}

function sheetTimeZone(sheet) {
  return sheet.getParent().getSpreadsheetTimeZone();
}

// Sorts rows 2..last by column A. Date-times sort in time order; any text left in column A
// (a schedule the bot could not read) sorts after them.
function sortByDate(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return;
  sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).sort({ column: DATE_TIME_COLUMN, ascending: true });
}

// The old layout had "TIME" in B1.
function hasSeparateTimeColumn(sheet) {
  return String(sheet.getRange(1, 2).getValue() || '').trim().toLowerCase() === 'time';
}

// Run ONCE by hand (select it in the editor and press Run) to switch the tab from separate Date
// and TIME columns to one DATE & TIME column. It first copies the tab to a hidden backup tab,
// then writes each row's date and time into column A as a real date-time, deletes the TIME
// column and sorts. Rows whose date can't be read keep their text and are counted in the log.
// Running it again does nothing.
function combineDateAndTime() {
  const sheet = getOrCreateSheet();
  if (!hasSeparateTimeColumn(sheet)) {
    Logger.log('Nothing to do: ' + SHEET_NAME + ' already has one DATE & TIME column.');
    return;
  }
  const spreadsheet = sheet.getParent();
  const zone = spreadsheet.getSpreadsheetTimeZone();
  const backupName = SHEET_NAME + ' backup ' + Utilities.formatDate(new Date(), zone, 'yyyy-MM-dd HH.mm');
  sheet.copyTo(spreadsheet).setName(backupName).hideSheet();

  const lastRow = sheet.getLastRow();
  let converted = 0;
  const unreadable = [];
  if (lastRow >= 2) {
    const range = sheet.getRange(2, 1, lastRow - 1, 2);
    const values = range.getValues();
    const shown = range.getDisplayValues();
    let previousDate = '';
    const combined = values.map((cells, i) => {
      const dateText = String(shown[i][0] || '').trim();
      const timeText = String(shown[i][1] || '').trim();
      let dateKey = dateKeyFromValue(cells[0], zone);
      // Older rows only wrote the date on a day's first match.
      if (!dateKey && !dateText && timeText) dateKey = previousDate;
      if (dateKey) previousDate = dateKey;
      if (!dateKey) {
        if (dateText || timeText) unreadable.push(i + 2);
        return [[dateText, timeText].filter(Boolean).join(' ')];
      }
      converted++;
      return [Utilities.parseDate(dateKey + ' ' + timeKeyFromValue(cells[1], zone), zone, 'yyyy-MM-dd HH:mm:ss')];
    });
    sheet.getRange(2, 1, combined.length, 1).setValues(combined);
  }
  sheet.deleteColumn(2);
  sheet.getRange(1, 1).setValue(DATE_TIME_HEADER).setFontWeight('bold');
  if (sheet.getMaxRows() > 1) sheet.getRange(2, 1, sheet.getMaxRows() - 1, 1).setNumberFormat(DATE_TIME_FORMAT);
  sortByDate(sheet);
  Logger.log('Combined ' + converted + ' row(s). Backup tab: "' + backupName + '" (hidden).'
    + (unreadable.length ? ' Could not read the date on row(s) ' + unreadable.join(', ') + ' (before sorting); their text was kept in column A.' : ''));
}

function dateKeyFromValue(value, zone) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, zone, 'yyyy-MM-dd');
  }

  const text = String(value || '').trim().replace(/^[A-Za-z]+,\s*/, '');
  if (!text) return '';
  const months = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
  };
  const named = text.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{2,4})$/);
  if (named && months[named[1].slice(0, 3).toLowerCase()]) {
    const year = named[3].length === 2 ? '20' + named[3] : named[3];
    return year + '-' + pad2(months[named[1].slice(0, 3).toLowerCase()]) + '-' + pad2(named[2]);
  }
  const numeric = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (!numeric) return '';
  const year = numeric[3].length === 2 ? '20' + numeric[3] : numeric[3];
  return year + '-' + pad2(numeric[1]) + '-' + pad2(numeric[2]);
}

function timeKeyFromValue(value, zone) {
  if (value instanceof Date && !isNaN(value.getTime())) {
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
  return sheet;
}

// Apps Script web apps always answer HTTP 200; the real status lives in the JSON body.
function reply(status, payload) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: status, ...payload }))
    .setMimeType(ContentService.MimeType.JSON);
}
