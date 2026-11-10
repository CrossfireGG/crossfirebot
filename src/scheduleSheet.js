// Posts confirmed match schedules and approved caster stream links to a Google Sheet
// through an Apps Script web app. See docs/schedule-log-apps-script.gs for the script
// the sheet owner deploys.

const DEFAULT_TIMEOUT_MS = 45_000;
const SCHEDULE_SHEET_TIME_ZONE = 'America/New_York';

// Short weekday, e.g. "Mon, November 2, 2026" (Mon, Tues, Wed, Thurs, Fri, Sat, Sun).
const SHORT_WEEKDAYS = { Monday: 'Mon', Tuesday: 'Tues', Wednesday: 'Wed', Thursday: 'Thurs', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' };

function formatDateInZone(date, timeZone) {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(date);
  const rest = new Intl.DateTimeFormat('en-US', { timeZone, month: 'long', day: 'numeric', year: 'numeric' }).format(date);
  return `${SHORT_WEEKDAYS[weekday] || weekday}, ${rest}`;
}

function formatTimeInZone(date, timeZone) {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date);
}

// Splits a confirmed schedule into the sheet's Date and Time columns.
// Parsed proposals carry an ISO time; free-text ones fall back to the raw text in the Date column.
export function splitScheduleForSheet({ scheduledAtIso, scheduledAt, timezone }) {
  const date = scheduledAtIso ? new Date(scheduledAtIso) : null;
  if (date && !Number.isNaN(date.getTime())) {
    // The operations sheet is intentionally normalized to Eastern Time even when
    // a team entered CST/PST or another accepted timezone in Discord.
    const zone = SCHEDULE_SHEET_TIME_ZONE;
    return { date: formatDateInZone(date, zone), time: formatTimeInZone(date, zone) };
  }
  return { date: String(scheduledAt || '').trim(), time: '' };
}

export function buildScheduleSheetRow({ stored, proposal, details = {}, approvedBy = null, acceptedBy = null, kind = null }) {
  const match = stored?.match || {};
  const { date, time } = splitScheduleForSheet({
    scheduledAtIso: proposal?.scheduledAtIso || null,
    scheduledAt: proposal?.scheduledAt || match.scheduledAt || '',
    timezone: proposal?.timezone || null
  });
  return {
    date,
    time,
    team1: match.teamA || '',
    team2: match.teamB || '',
    faceitLink: match.faceitUrl || '',
    round: details.round ? String(details.round).replace(/^Round\s+/i, '') : '',
    group: details.group ? String(details.group).replace(/^Group\s+/i, '') : '',
    // Extra context the sheet can show later with a script-only change.
    matchId: match.id || proposal?.matchId || '',
    kind: kind || proposal?.kind || 'schedule',
    scheduledAtIso: proposal?.scheduledAtIso || null,
    timezone: proposal?.timezone || null,
    proposedBy: proposal?.proposedBy || '',
    acceptedBy: acceptedBy || proposal?.acceptedBy || '',
    approvedBy: approvedBy || '',
    loggedAt: new Date().toISOString()
  };
}

// Everything the sheet needs to put an approved caster's link on the match's row.
// The FACEIT link is how the script finds the row; the rest is context for logging.
export function buildStreamLinkSheetRow(request, { approvedBy = null, highlight = null } = {}) {
  const [team1 = '', team2 = ''] = String(request?.matchup || '').split(/\s+vs\.?\s+/i).map((team) => team.trim());
  return {
    faceitLink: request?.faceitUrl || '',
    streamUrl: request?.streamUrl || '',
    streamPlatform: request?.streamPlatform || '',
    team1,
    team2,
    matchId: request?.matchId || '',
    requestId: request?.id || '',
    requesterId: request?.requesterId || '',
    requesterTag: request?.requesterTag || '',
    approvedBy: approvedBy || request?.reviewedBy || '',
    highlight: highlight || '',
    loggedAt: new Date().toISOString()
  };
}

// The main stream's Twitch link for the match's row. `highlight` tells the sheet how to colour the
// row: 'main' (main stream), 'community' (community cast) or 'none' (clear it).
export function buildMainStreamSheetRow(coverage, { streamUrl, highlight = 'main', actorId = null } = {}) {
  const [team1 = '', team2 = ''] = coverage?.teamA && coverage?.teamB
    ? [coverage.teamA, coverage.teamB]
    : String(coverage?.matchup || '').split(/\s+vs\.?\s+/i).map((team) => team.trim());
  return {
    faceitLink: coverage?.faceitUrl || '',
    streamUrl: streamUrl || '',
    streamPlatform: 'twitch',
    team1,
    team2,
    matchId: coverage?.matchId || '',
    requestId: 'main-stream',
    requesterId: '',
    requesterTag: 'CROSSFIRE main stream',
    approvedBy: actorId || '',
    highlight,
    loggedAt: new Date().toISOString()
  };
}

export class LogOnlyScheduleSheet {
  mode = 'log-only';

  constructor({ log = console } = {}) {
    this.log = log;
  }

  async append(row) {
    this.log.info?.(`Schedule sheet (log-only): ${row.team1} vs ${row.team2} on ${row.date} ${row.time}`.trim());
    return { ok: true, skipped: true, error: null };
  }

  async addStreamLink(row) {
    this.log.info?.(`Schedule sheet (log-only): stream link ${row.streamUrl} for ${row.team1} vs ${row.team2} (${row.faceitLink})`);
    return { ok: true, skipped: true, error: null };
  }

  async writeMatchResult(row) {
    this.log.info?.(`Schedule sheet (log-only): result "${row.result}" for ${row.faceitLink}`);
    return { ok: true, skipped: true, error: null };
  }

  async markStatsCollected(row) {
    this.log.info?.(`Schedule sheet (log-only): stats collected for ${row.faceitLink}`);
    return { ok: true, skipped: true, error: null };
  }

  async removeStreamLink(row) {
    this.log.info?.(`Schedule sheet (log-only): remove stream link ${row.streamUrl} for ${row.team1} vs ${row.team2} (${row.faceitLink})`);
    return { ok: true, skipped: true, error: null };
  }

  async readAvailability() {
    return { ok: false, skipped: true, error: 'no Google Sheet connected (SCHEDULE_SHEET_WEBHOOK_URL is empty)', tabs: [] };
  }

  async readTeamInfo() {
    return { ok: false, skipped: true, error: 'no Google Sheet connected (SCHEDULE_SHEET_WEBHOOK_URL is empty)', rows: [] };
  }

  async updateTeamInfo() {
    return { ok: false, skipped: true, error: 'no Google Sheet connected (SCHEDULE_SHEET_WEBHOOK_URL is empty)' };
  }

  async readCasterApplications() {
    return { ok: false, skipped: true, error: 'no Google Sheet connected (SCHEDULE_SHEET_WEBHOOK_URL is empty)', headers: [], rows: [], lastRow: null };
  }

  async readRosterTeam() {
    return { ok: false, skipped: true, error: 'no Google Sheet connected (SCHEDULE_SHEET_WEBHOOK_URL is empty)', team: null };
  }

  async writeRosterChange() {
    return { ok: false, skipped: true, error: 'no Google Sheet connected (SCHEDULE_SHEET_WEBHOOK_URL is empty)' };
  }

  // Without a sheet there is nothing to look in, so no form is ever confirmed here.
  async lookupPostCastForms(requestIds) {
    this.log.info?.(`Schedule sheet (log-only): cannot look up post-cast forms for ${(requestIds || []).join(', ')}`);
    return { ok: true, skipped: true, error: null, found: {} };
  }
}

export class AppsScriptScheduleSheet {
  mode = 'apps-script';

  constructor({ webhookUrl, secret, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch, log = console }) {
    this.webhookUrl = webhookUrl;
    this.secret = secret;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.log = log;
  }

  // Adds or updates the match's schedule row (columns A-H).
  async append(row) {
    const { body, ...result } = await this.post('schedule', row);
    if (!result.ok) return result;
    return { ...result, row: body.row ?? null, updated: Boolean(body.updated) };
  }

  // Appends an approved stream URL to the match's STREAM cell.
  async addStreamLink(row) {
    const { body, ...result } = await this.post('streamLink', row);
    if (!result.ok) return result;
    return { ...result, row: body.row ?? null, duplicate: Boolean(body.duplicate) };
  }

  // Takes one stream URL back out of the match's STREAM cell.
  async removeStreamLink(row) {
    const { body, ...result } = await this.post('removeStreamLink', row);
    if (!result.ok) return result;
    return { ...result, row: body.row ?? null, removed: Boolean(body.removed) };
  }

  // Writes the final result into the match row's "Result" column (created if missing).
  async writeMatchResult(row) {
    const { body, ...result } = await this.post('matchResult', row);
    if (!result.ok) return result;
    return { ...result, row: body.row ?? null };
  }

  // Ticks the match row's "Stats Collected?" box.
  async markStatsCollected(row) {
    const { body, ...result } = await this.post('statsCollected', row);
    if (!result.ok) return result;
    return { ...result, row: body.row ?? null, already: Boolean(body.already) };
  }

  // Which of these request IDs have a post-cast form response: { found: { id: { submittedAt } } }.
  async lookupPostCastForms(requestIds) {
    const { body, ...result } = await this.post('postCastForms', null, { requestIds });
    if (!result.ok) return { ...result, found: {} };
    return { ...result, found: body.found && typeof body.found === 'object' ? body.found : {} };
  }

  // Streaming Application responses after `afterRow`: { headers, rows: [{ row, values }], lastRow }.
  // Without afterRow only lastRow comes back (where to start).
  async readCasterApplications(afterRow = null) {
    const { body, ...result } = await this.post('casterApplications', null, { afterRow });
    if (!result.ok) return { ...result, headers: [], rows: [], lastRow: null };
    return {
      ...result,
      headers: Array.isArray(body.headers) ? body.headers : [],
      rows: Array.isArray(body.rows) ? body.rows : [],
      lastRow: Number.isInteger(body.lastRow) ? body.lastRow : null
    };
  }

  // One team's block on the player tracking tab: { team: { teamName, headerRow, faceitUrl, slots } | null }.
  // query: { spreadsheetId, sheetName, faceitTeamId?, teamName?, captainDiscord? }
  async readRosterTeam(query) {
    const { body, ...result } = await this.post('rosterTeam', null, query);
    if (!result.ok) return { ...result, team: null };
    return { ...result, team: body.team && typeof body.team === 'object' ? body.team : null };
  }

  // Writes a roster change: { spreadsheetId, sheetName, teamName, headerRow, targetRow, expectedAlias, mode, player, logLine }.
  async writeRosterChange(change) {
    const { body, ...result } = await this.post('rosterChange', null, change);
    if (!result.ok) return result;
    return { ...result, row: body.row ?? null, movedTo: body.movedTo || null };
  }

  // The crew availability tabs: { tabs: [{ name, values, backgrounds }] }.
  async readAvailability() {
    const { body, ...result } = await this.post('availability', null);
    if (!result.ok) return { ...result, tabs: [] };
    return { ...result, tabs: Array.isArray(body.tabs) ? body.tabs : [] };
  }

  // The "Team Info" tab: { rows: [[{ text, link }]] } (row 0 is the header).
  async readTeamInfo() {
    const { body, ...result } = await this.post('teamInfo', null);
    if (!result.ok) return { ...result, rows: [] };
    return { ...result, rows: Array.isArray(body.rows) ? body.rows : [] };
  }

  // Sets columns on one team's "Team Info" row: fields = { Header: { text } | { link, label } | { clear: true } }.
  async updateTeamInfo(team, fields) {
    const { body, ...result } = await this.post('teamInfoUpdate', null, { team, fields });
    if (!result.ok) return result;
    return { ...result, row: body.row ?? null, created: Boolean(body.created) };
  }

  async post(action, row, extra = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.webhookUrl, {
        method: 'POST',
        // text/plain keeps Apps Script from rejecting the body and still exposes postData.contents.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ secret: this.secret, action, row, ...extra }),
        redirect: 'follow',
        signal: controller.signal
      });
      const text = await response.text();
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }

      if (response.status >= 400) {
        return { ok: false, skipped: false, error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
      }
      // Apps Script always answers 200; the real outcome is in the JSON body.
      if (!body || body.ok !== true) {
        const reason = body?.error
          || (text.includes('<html') ? 'Apps Script returned an HTML page (check the deployment is set to "Anyone")' : text.slice(0, 200));
        return { ok: false, skipped: false, error: reason || 'unexpected response' };
      }
      return { ok: true, skipped: false, error: null, body };
    } catch (error) {
      const message = error?.name === 'AbortError'
        ? `timed out after ${this.timeoutMs}ms; Apps Script may still finish the write, so check the sheet before retrying`
        : (error?.message || String(error));
      return { ok: false, skipped: false, error: message };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createScheduleSheet(config, { fetchImpl, log = console } = {}) {
  if (!config?.scheduleSheetWebhookUrl) {
    return new LogOnlyScheduleSheet({ log });
  }
  return new AppsScriptScheduleSheet({
    webhookUrl: config.scheduleSheetWebhookUrl,
    secret: config.scheduleSheetSecret,
    timeoutMs: Math.max(1, Number(config.scheduleSheetTimeoutSeconds || 10)) * 1000,
    fetchImpl,
    log
  });
}
