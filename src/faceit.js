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

  async getMatch(matchId, source = null) {
    const raw = await this.request(`/matches/${encodeURIComponent(matchId)}`);
    return normalizeMatch(raw, source || raw.source || { type: 'match', id: matchId, name: '' });
  }

  async getMatchesForSource(source) {
    const sourcePath = source.type === 'championship'
      ? `/championships/${source.id}/matches`
      : `/tournaments/${source.id}/matches`;
    const all = [];
    const seen = new Set();
    let offset = 0;
    const limit = 100;
    const maxPages = 50;
    let pages = 0;
    let duplicatePages = 0;

    while (true) {
      pages += 1;
      const data = await this.request(`${sourcePath}?offset=${offset}&limit=${limit}`);
      const items = data.items || [];
      const newItems = items.filter((item) => {
        const id = item.match_id || item.id;
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      all.push(...newItems);

      if (!items.length || items.length < limit || pages >= maxPages) break;

      duplicatePages = newItems.length ? 0 : duplicatePages + 1;
      if (duplicatePages >= 2) break;

      const nextOffset = Number(data.end);
      offset = Number.isInteger(nextOffset) && nextOffset > offset
        ? nextOffset
        : offset + items.length;
    }

    return all.map((raw) => normalizeMatch(raw, source)).filter(Boolean);
  }

}

function normalizeMatch(raw, source) {
  const teams = raw.teams || {};
  const faction1 = teams.faction1 || teams.faction_a || {};
  const faction2 = teams.faction2 || teams.faction_b || {};
  const teamA = cleanName(faction1.name || faction1.nickname || '');
  const teamB = cleanName(faction2.name || faction2.nickname || '');

  const id = raw.match_id || raw.id;
  if (!id || !teamA || !teamB) return null;
  const categoryName = extractCategoryName(raw, source);
  const score = extractMatchScore(raw);

  return {
    id,
    status: raw.status || 'unknown',
    round: categoryName,
    group: extractGroup(raw, source),
    categoryName,
    source,
    teamA,
    teamB,
    teamAScore: score?.teamAScore ?? null,
    teamBScore: score?.teamBScore ?? null,
    resultScore: score ? `${score.teamAScore}-${score.teamBScore}` : null,
    faceitUrl: normalizeFaceitUrl(raw.faceit_url || raw.match_url),
    scheduledAt: raw.scheduled_at ? formatFaceitSchedule(raw.scheduled_at) : null,
    raw
  };
}

function extractMatchScore(raw) {
  const scorePair = [
    extractScorePair(raw.results?.score),
    extractScorePair(raw.results?.scores),
    extractScorePair(raw.score),
    extractScorePair(raw.scores)
  ].find(Boolean);
  if (scorePair) return scorePair;

  const mapScorePair = extractMapWinScore(raw);
  if (mapScorePair) return mapScorePair;

  return null;
}

function extractScorePair(value) {
  if (!value || typeof value !== 'object') return null;

  const teamAScore = firstNumber(
    value.faction1,
    value.faction_1,
    value.faction_a,
    value.team1,
    value.team_1
  );
  const teamBScore = firstNumber(
    value.faction2,
    value.faction_2,
    value.faction_b,
    value.team2,
    value.team_2
  );

  return Number.isInteger(teamAScore) && Number.isInteger(teamBScore)
    ? { teamAScore, teamBScore }
    : null;
}

function extractMapWinScore(raw) {
  const maps = [
    raw.maps,
    raw.results?.maps,
    raw.results?.map_results,
    raw.detailed_results?.maps,
    raw.detailed_results?.map_results
  ].find((value) => Array.isArray(value));

  if (!maps?.length) return null;

  let teamAScore = 0;
  let teamBScore = 0;
  for (const map of maps) {
    const mapTeamAScore = firstNumber(map.faction1_score, map.faction_1_score, map.team1_score, map.team_1_score);
    const mapTeamBScore = firstNumber(map.faction2_score, map.faction_2_score, map.team2_score, map.team_2_score);
    if (!Number.isInteger(mapTeamAScore) || !Number.isInteger(mapTeamBScore) || mapTeamAScore === mapTeamBScore) continue;
    if (mapTeamAScore > mapTeamBScore) {
      teamAScore += 1;
    } else {
      teamBScore += 1;
    }
  }

  return teamAScore || teamBScore ? { teamAScore, teamBScore } : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isInteger(number)) return number;
  }
  return null;
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

function extractRound(raw, source = {}) {
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

  const explicitBracketLabel = textCandidates
    .map((candidate) => normalizePlayoffRoundLabel(candidate, raw))
    .find(Boolean);
  if (explicitBracketLabel) return explicitBracketLabel;

  const bracketRound = bracketRoundName(raw.round ?? raw.round_number, raw, source);
  if (bracketRound) return bracketRound;

  const fallback = textCandidates.find((candidate) => typeof candidate === 'string' && candidate.trim());
  return cleanName(fallback || 'Round Matches');
}

function extractCategoryName(raw, source) {
  if (isGroupStageSource(source)) {
    const roundNumber = extractGroupStageRoundNumber(raw);
    if (roundNumber) return `Group Stage - Round ${roundNumber}`;

    return 'Group Stage';
  }

  return extractRound(raw);
}

function extractGroupStageRoundNumber(raw) {
  const textCandidates = [
    raw.round_name,
    raw.round_label,
    raw.bracket_round,
    raw.bracket_round_name,
    raw.stage_name,
    raw.bracket_name
  ];

  for (const candidate of textCandidates) {
    const roundMatch = cleanName(candidate || '').match(/\bround\s*(1|2|3)\b/i);
    if (roundMatch) return Number(roundMatch[1]);
  }

  for (const value of [raw.round_number, raw.round]) {
    const number = Number(value);
    if ([1, 2, 3].includes(number)) return number;
  }

  return null;
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

    const numberMatch = text.match(/\bgroup\s*(\d+)\b/i);
    if (numberMatch) return `Group ${numberToLetters(Number(numberMatch[1]))}`;
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

function normalizePlayoffRoundLabel(value, raw = {}) {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (!isUsefulBracketLabel(value)) return null;

  const text = cleanName(value);
  const normalized = text.toLowerCase();
  const context = [
    raw.bracket_name,
    raw.stage_name,
    raw.group_name,
    raw.round_name,
    raw.round_label,
    raw.bracket_round,
    raw.bracket_round_name
  ].map((candidate) => String(candidate || '').toLowerCase()).join(' ');
  const bracket = bracketSide(context || normalized);

  const losersRound = normalized.match(/\b(?:losers?|lower|lb)\s*round\s*(\d+)\b/);
  if (losersRound) return `Losers Round ${losersRound[1]}`;

  if (normalized.includes('losers final') || normalized.includes('lower final') || normalized.includes('lb final')) {
    return 'Losers Final';
  }

  if (normalized.includes('grand final')) return 'Grand Final (BO5)';

  if ((normalized.includes('winner') || normalized.includes('upper') || normalized.includes('wb')) && normalized.includes('final')) {
    return 'WB Final';
  }

  if (normalized.includes('round of 32')) return bracket === 'losers' ? 'Losers Round 1' : 'WB Round of 32';
  if (normalized.includes('round of 16')) return bracket === 'losers' ? 'Losers Round 1' : 'WB Round of 16';
  if (normalized.includes('quarter')) return bracket === 'losers' ? 'Losers Round 2' : 'WB Quarterfinals';
  if (normalized.includes('semi')) return bracket === 'losers' ? 'Losers Round 4' : 'WB Semifinals';
  if (normalized.includes('final')) return bracket === 'losers' ? 'Losers Final' : 'WB Final';

  return text;
}

function bracketRoundName(value, raw = {}, source = {}) {
  const round = Number(value);
  if (!Number.isInteger(round)) return null;

  const sourceText = String(source?.name || '').toLowerCase();
  const context = [
    raw.bracket_name,
    raw.stage_name,
    raw.group_name,
    raw.round_name,
    raw.round_label,
    raw.bracket_round,
    raw.bracket_round_name
  ].map((candidate) => String(candidate || '').toLowerCase()).join(' ');
  const bracket = bracketSide(context);

  if (sourceText.includes('playoff')) {
    if (bracket === 'losers') {
      const losersNames = {
        1: 'Losers Round 1',
        2: 'Losers Round 2',
        3: 'Losers Round 3',
        4: 'Losers Round 4',
        5: 'Losers Round 5',
        6: 'Losers Round 6',
        7: 'Losers Round 7',
        8: 'Losers Final'
      };
      return losersNames[round] || `Losers Round ${round}`;
    }

    const winnersNames = {
      1: 'WB Round of 32',
      2: 'WB Round of 16',
      3: 'WB Quarterfinals',
      4: 'WB Semifinals',
      5: 'WB Final',
      6: 'Grand Final (BO5)'
    };
    return winnersNames[round] || `WB Round ${round}`;
  }

  const names = {
    1: 'Round of 16',
    2: 'Quarter Finals',
    3: 'Semi Finals',
    4: 'Grand Finals',
    5: 'Grand Finals'
  };

  return names[round] || `Round ${round}`;
}

function bracketSide(value) {
  const text = String(value || '').toLowerCase();
  if (/\b(?:losers?|lower|lb)\b/.test(text)) return 'losers';
  if (/\b(?:winners?|winner|upper|wb)\b/.test(text)) return 'winners';
  return '';
}

function cleanName(value) {
  return String(value).trim().replace(/\s+/g, ' ');
}
