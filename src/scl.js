const SCL_API_BASE = 'https://api.scl.gg/api/v1/integrations/leagues';

export class SclApiError extends Error {
  constructor(message, { status = null, code = null, retryable = false } = {}) {
    super(message);
    this.name = 'SclApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export class SclClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  get enabled() {
    return Boolean(this.apiKey);
  }

  async getFaceitMatch(matchId) {
    if (!this.apiKey) {
      throw new Error('SCL_API_KEY is not configured');
    }

    const url = `${SCL_API_BASE}/matches/faceit/${encodeURIComponent(matchId)}`;
    console.log(`[SCL] GET issued match_id=${matchId}`);

    let response;
    try {
      response = await fetch(url, {
        headers: {
          Authorization: this.apiKey,
          Accept: 'application/json'
        }
      });
    } catch (error) {
      throw new SclApiError(`SCL network error: ${error.message}`, { code: 'NETWORK_ERROR', retryable: true });
    }

    console.log(`[SCL] GET returned status=${response.status} match_id=${matchId}`);

    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new SclApiError('SCL returned invalid JSON', {
        status: response.status,
        code: 'INVALID_RESPONSE',
        retryable: response.status >= 500
      });
    }

    if (!response.ok || data.error) {
      const code = data.error?.code || String(response.status);
      const message = data.error?.message || text || response.statusText;
      throw new SclApiError(`SCL ${code}: ${message}`, {
        status: response.status,
        code,
        retryable: response.status >= 500
      });
    }

    return data.data || data;
  }
}
