const API_BASE = 'https://open.faceit.com/data/v4';

export class FaceitClient {
  constructor(apiKey, sources) {
    this.apiKey = apiKey;
    this.sources = sources;
  }

  async request(path) {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`FACEIT ${response.status}: ${text}`);
    }

    return response.json();
  }

  async getMatches() {
    const all = [];

    for (const source of this.sources) {
      all.push(...await this.getMatchesForSource(source));
    }

    return all;
  }

  async getMatchesForSource(source) {
    const sourcePath = source.type === 'championship'
      ? `/championships/${source.id}/matches`
      : `/tournaments/${source.id}/matches`;
    const all = [];
    const seen = new Set();
    let offset = 0;
    const limit = 100;

    while (true) {
      const data = await this.request(`${sourcePath}?offset=${offset}&limit=${limit}`);
      const items = data.items || [];
      const newItems = items.filter((item) => {
        const id = item.match_id || item.id;
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      all.push(...newItems);

      if (!items.length || !newItems.length) break;
      offset += items.length;
    }

    return all.map((raw) => normalizeMatch(raw, source)).filter(Boolean);
  }

}

function normalizeMatch(raw, source) {
  const teams = raw.teams || {};
  const faction1 = teams.faction1 || teams.faction_a || {};
  const faction2 = teams.faction2 || teams.faction_b || {};
  const teamA = cleanName(faction1.name || faction1.nickname || 'Team A');
  const teamB = cleanName(faction2.name || faction2.nickname || 'Team B');

  const id = raw.match_id || raw.id;
  if (!id) return null;
  const categoryName = extractCategoryName(raw, source);

  return {
    id,
    status: raw.status || 'unknown',
    round: categoryName,
    group: extractGroup(raw, source),
    categoryName,
    source,
    teamA,
    teamB,
    faceitUrl: normalizeFaceitUrl(raw.faceit_url || raw.match_url),
    scheduledAt: raw.scheduled_at ? formatFaceitSchedule(raw.scheduled_at) : null,
    raw
  };
}

function normalizeFaceitUrl(url) {
  if (!url) return null;
  return String(url).replace('%7Blang%7D', 'en').replace('{lang}', 'en');
}

function formatFaceitSchedule(value) {
  const date = new Date(Number(value) * 1000);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(date);
}

function extractRound(raw) {
  const textCandidates = [
    raw.round_name,
    raw.round_label,
    raw.bracket_round,
    raw.bracket_round_name,
    raw.group_name,
    raw.group,
    raw.stage_name,
    raw.bracket_name,
    raw.competition_name
  ];

  const explicitBracketLabel = textCandidates.find(isUsefulBracketLabel);
  if (explicitBracketLabel) return cleanName(explicitBracketLabel);

  const bracketRound = bracketRoundName(raw.round ?? raw.round_number);
  if (bracketRound) return bracketRound;

  const fallback = textCandidates.find((candidate) => typeof candidate === 'string' && candidate.trim());
  return cleanName(fallback || 'Round Matches');
}

function extractCategoryName(raw, source) {
  if (isGroupStageSource(source)) {
    const roundNumber = Number(raw.round ?? raw.round_number);
    if (Number.isInteger(roundNumber) && roundNumber > 0) {
      return `Round ${roundNumber} Group Stage`;
    }

    const textRound = cleanName(raw.round_name || raw.round_label || '');
    const roundMatch = textRound.match(/\bround\s*(\d+)\b/i);
    if (roundMatch) return `Round ${roundMatch[1]} Group Stage`;

    return 'Group Stage';
  }

  return extractRound(raw);
}

function extractGroup(raw, source) {
  const candidates = [
    raw.group_name,
    raw.group,
    raw.bracket_name,
    raw.stage_name
  ].filter(Boolean);

  for (const candidate of candidates) {
    const text = cleanName(candidate);
    const letterMatch = text.match(/\bgroup\s*([a-z])\b/i);
    if (letterMatch) return `Group ${letterMatch[1].toUpperCase()}`;
  }

  if (isGroupStageSource(source)) {
    const groupNumber = Number(raw.group ?? raw.group_number);
    if (Number.isInteger(groupNumber) && groupNumber > 0) {
      return `Group ${numberToLetters(groupNumber)}`;
    }
  }

  return '';
}

function numberToLetters(value) {
  let number = value;
  let letters = '';

  while (number > 0) {
    number -= 1;
    letters = String.fromCharCode(65 + (number % 26)) + letters;
    number = Math.floor(number / 26);
  }

  return letters;
}

function isGroupStageSource(source) {
  return String(source?.name || '').toLowerCase().includes('group');
}

function isUsefulBracketLabel(value) {
  if (typeof value !== 'string' || !value.trim()) return false;

  const normalized = value.toLowerCase();
  const usefulWords = [
    'loser',
    'lower',
    'winner',
    'upper',
    'round of',
    'quarter',
    'semi',
    'final'
  ];

  return usefulWords.some((word) => normalized.includes(word));
}

function bracketRoundName(value) {
  const round = Number(value);
  if (!Number.isInteger(round)) return null;

  const names = {
    1: 'Round of 16',
    2: 'Quarter Finals',
    3: 'Semi Finals',
    4: 'Grand Finals',
    5: 'Grand Finals'
  };

  return names[round] || `Round ${round}`;
}

function cleanName(value) {
  return String(value).trim().replace(/\s+/g, ' ');
}
