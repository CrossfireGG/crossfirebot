// Website integration for approved community stream requests.
//
// The bot only ever talks to a publisher object with one method:
//   publish(request, context) -> { ok, websiteId, error }
// Swap the implementation (HTTP, webhook, CMS SDK, Google Sheet...) without
// touching the Discord code. See README "Website contract" for the payload.

export const WEBSITE_PAYLOAD_VERSION = 1;

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export function buildWebsitePayload(request, context = {}) {
  const scheduledAt = request.faceitScheduledAtIso || request.dateTimeIso || null;
  const [teamA, teamB] = splitMatchup(request.matchup);
  return {
    version: WEBSITE_PAYLOAD_VERSION,
    source: 'crossfirebot',
    request_id: request.id,
    status: context.status || websiteStatusFor(request),
    event: {
      title: request.matchup || null,
      starts_at: scheduledAt
    },
    match: {
      faceit_match_id: request.matchId || null,
      faceit_url: request.faceitUrl || null,
      faceit_verified: Boolean(request.faceitLinkValid),
      faceit_status: request.faceitStatus || null,
      team_a: teamA,
      team_b: teamB,
      scheduled_at: scheduledAt
    },
    stream: {
      url: request.streamUrl,
      platform: request.streamPlatform || null,
      caster: {
        discord_id: String(request.requesterId),
        discord_name: request.requesterTag || null,
        social_url: request.socialUrl
      }
    },
    approved_at: request.reviewedAt || null,
    approved_by_discord_id: request.reviewedBy ? String(request.reviewedBy) : null,
    sent_at: new Date().toISOString()
  };
}

export function websiteStatusFor(request) {
  const status = String(request?.status || '');
  if (['approved', 'approving', 'publish_failed'].includes(status)) return 'approved';
  if (['revoked', 'canceled'].includes(status)) return status;
  if (status === 'withdrawn') return 'canceled';
  return status || 'unknown';
}

export function createWebsitePublisher(config, { fetchImpl = globalThis.fetch, log = console, sleep = defaultSleep } = {}) {
  if (!config.websiteEndpoint) return new LogOnlyWebsitePublisher({ log });
  return new HttpWebsitePublisher({
    endpoint: config.websiteEndpoint,
    apiKey: config.websiteApiKey,
    timeoutMs: Math.max(1, Number(config.websiteTimeoutSeconds || 10)) * 1000,
    maxAttempts: Math.max(1, Number(config.websiteMaxAttempts || 3)),
    fetchImpl,
    log,
    sleep
  });
}

export class LogOnlyWebsitePublisher {
  constructor({ log = console } = {}) {
    this.log = log;
    this.mode = 'log-only';
  }

  async publish(request, context = {}) {
    this.log.info?.('[Website] log-only publish:', JSON.stringify(buildWebsitePayload(request, context)));
    return { ok: true, websiteId: `local-${request.id}`, error: null };
  }
}

export class HttpWebsitePublisher {
  constructor({ endpoint, apiKey, timeoutMs, maxAttempts, fetchImpl, log = console, sleep = defaultSleep }) {
    if (!fetchImpl) throw new Error('fetch is not available in this Node runtime');
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.maxAttempts = maxAttempts;
    this.fetchImpl = fetchImpl;
    this.log = log;
    this.sleep = sleep;
    this.mode = 'http';
  }

  async publish(request, context = {}) {
    const payload = buildWebsitePayload(request, context);
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `caster-request-${request.id}`,
      'User-Agent': 'crossfirebot-caster/1'
    };
    let lastError = 'unknown error';
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.timeoutMs)
        });
        const body = String(await response.text().catch(() => '')).slice(0, 300);
        if (response.status >= 200 && response.status < 300) {
          return { ok: true, websiteId: extractWebsiteId(body), error: null };
        }
        lastError = `HTTP ${response.status}: ${body || '<empty body>'}`;
        if (!RETRYABLE_STATUSES.has(response.status)) {
          this.log.warn?.(`[Website] rejected request ${request.id} (no retry): ${lastError}`);
          return { ok: false, websiteId: null, error: lastError };
        }
      } catch (error) {
        lastError = error?.name === 'TimeoutError' || error?.name === 'AbortError'
          ? `Timed out after ${this.timeoutMs}ms`
          : `${error?.name || 'Error'}: ${error?.message || error}`;
      }
      this.log.warn?.(`[Website] publish attempt ${attempt}/${this.maxAttempts} for ${request.id} failed: ${lastError}`);
      if (attempt < this.maxAttempts) await this.sleep(2 ** attempt * 1000);
    }
    return { ok: false, websiteId: null, error: lastError };
  }
}

function extractWebsiteId(body) {
  try {
    const data = JSON.parse(body);
    if (data && typeof data === 'object' && data.id !== undefined && data.id !== null) return String(data.id);
  } catch {
    // Non-JSON bodies are fine; the id is optional.
  }
  return null;
}

function splitMatchup(matchup) {
  const parts = String(matchup || '').split(/\s+vs\.?\s+/i);
  return parts.length === 2 ? [parts[0].trim(), parts[1].trim()] : [null, null];
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
