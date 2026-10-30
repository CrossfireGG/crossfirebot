// Posts confirmed match schedules and approved caster stream links to a Google Sheet
// through an Apps Script web app. See docs/schedule-log-apps-script.gs for the script
// the sheet owner deploys.

const DEFAULT_TIMEOUT_MS = 10_000;

// Matches the existing sheet style, e.g. "Monday, November 2, 2026".
function formatDateInZone(date, timeZone) {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date);
}

function formatTimeInZone(date, timeZone) {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date);
}

// Splits a confirmed schedule into the sheet's Date and Time columns.
// Parsed proposals carry an ISO time; free-text ones fall back to the raw text in the Date column.
export function splitScheduleForSheet({ scheduledAtIso, scheduledAt, timezone }) {
  const date = scheduledAtIso ? new Date(scheduledAtIso) : null;
  if (date && !Number.isNaN(date.getTime())) {
    const zone = timezone || 'America/New_York';
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
export function buildStreamLinkSheetRow(request, { approvedBy = null } = {}) {
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

  // Appends an approved stream URL to the match's "Stream Link/s" cell.
  async addStreamLink(row) {
    const { body, ...result } = await this.post('streamLink', row);
    if (!result.ok) return result;
    return { ...result, row: body.row ?? null, duplicate: Boolean(body.duplicate) };
  }

  async post(action, row) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.webhookUrl, {
        method: 'POST',
        // text/plain keeps Apps Script from rejecting the body and still exposes postData.contents.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ secret: this.secret, action, row }),
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
      const message = error?.name === 'AbortError' ? `timed out after ${this.timeoutMs}ms` : (error?.message || String(error));
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
