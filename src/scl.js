const SCL_API_BASE = 'https://api.scl.gg/api/v1/integrations/leagues';

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

    const response = await fetch(`${SCL_API_BASE}/matches/faceit/${encodeURIComponent(matchId)}`, {
      headers: {
        Authorization: this.apiKey,
        Accept: 'application/json'
      }
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok || data.error) {
      const code = data.error?.code || response.status;
      const message = data.error?.message || text || response.statusText;
      throw new Error(`SCL ${code}: ${message}`);
    }

    return data.data || data;
  }
}
