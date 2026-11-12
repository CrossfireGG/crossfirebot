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
    return normalizeMatch(raw, source || sourceForMatch(raw, this.sources) || raw.source || { type: 'match', id: matchId, name: '' });
  }

  // A FACEIT player by their account nickname (the one in their profile link). null when FACEIT has
  // no such player; throws when FACEIT can't be reached.
  async getPlayerByNickname(nickname) {
    try {
      return await this.request(`/players?nickname=${encodeURIComponent(nickname)}`);
    } catch (error) {
      if (/^FACEIT 404:/.test(String(error?.message || ''))) return null;
      throw error;
    }
  }

  // Matches of a FACEIT hub (raw, with teams.faction1/2.roster): type 'ongoing' or 'past'.
  async getHubMatches(hubId, type = 'ongoing', limit = 20) {
    const body = await this.request(`/hubs/${encodeURIComponent(hubId)}/matches?type=${encodeURIComponent(type)}&offset=0&limit=${limit}`);
    return Array.isArray(body?.items) ? body.items : [];
  }

  // One match exactly as FACEIT sends it (getMatch reshapes it for league matches).
  async getMatchRaw(matchId) {
    return this.request(`/matches/${encodeURIComponent(matchId)}`);
  }

  // A FACEIT team: { team_id, name, leader (user_id), members: [{ user_id, nickname }] }.
  async getTeam(teamId) {
    return this.request(`/teams/${encodeURIComponent(teamId)}`);
  }

  // The map veto of a match: every ban and pick and which faction made it, from FACEIT's public
  // veto history (what the match room shows; the Data API only has the final picks). Raw payload
  // ({ tickets: [...] }), or null when FACEIT has none for the match.
  async getMatchVeto(matchId) {
    const response = await fetch(`https://api.faceit.com/democracy/v1/match/${encodeURIComponent(matchId)}/history`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000)
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`FACEIT veto history ${response.status}`);
    return (await response.json())?.payload || null;
  }

  // Per-map stats of a finished match (map names and final round scores). Raw FACEIT payload.
  async getMatchStats(matchId) {
    return this.request(`/matches/${encodeURIComponent(matchId)}/stats`);
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

    return all.map((raw, index) => normalizeMatch(raw, source, index)).filter(Boolean);
  }

}

// A single match fetched by ID doesn't say which configured source (Group Stage / Playoffs) it is
// from, and without that its round number was read with generic names (round 2 = "Quarter
// Finals"). Match it to the configured source by competition ID, or use FACEIT's competition name.
export function sourceForMatch(raw, sources = []) {
  const competitionId = raw?.competition_id || raw?.championship_id || raw?.tournament_id || null;
  const configured = competitionId ? (sources || []).find((source) => source.id === competitionId) : null;
  if (configured) return configured;
  if (raw?.competition_name) {
    return { type: raw.competition_type || 'championship', id: competitionId || raw.match_id || '', name: raw.competition_name };
  }
  return null;
}

function normalizeMatch(raw, source, sourceOrder = 0) {
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
    bracketOrder: extractBracketOrder(raw, sourceOrder),
    raw
  };
}

function extractBracketOrder(raw, sourceOrder) {
  const explicitOrder = firstNumber(
    raw.bracket_position,
    raw.bracket_pos,
    raw.match_position,
    raw.position,
    raw.order,
    raw.sort_order,
    raw.seed,
    raw.match_number
  );
  return Number.isInteger(explicitOrder) ? explicitOrder : sourceOrder;
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

  if (String(source?.name || '').toLowerCase().includes('playoff')) {
    const bracketRound = bracketRoundName(raw.round ?? raw.round_number, raw, source);
    if (bracketRound) return bracketRound;

    const combinedBracketLabel = normalizePlayoffRoundLabel(textCandidates.filter(Boolean).join(' '), raw);
    if (combinedBracketLabel) return combinedBracketLabel;
  }

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

  return extractRound(raw, source);
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
    const roundMatch = cleanName(candidate || '').match(/\bround\s*(\d+)\b/i);
    if (roundMatch) return Number(roundMatch[1]);
  }

  for (const value of [raw.round_number, raw.round]) {
    const number = Number(value);
    if (Number.isInteger(number) && number > 0) return number;
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
  if (losersRound) return `Lower Bracket - Round ${losersRound[1]}`;

  const genericBracketRound = normalized.match(/\bround\s*(\d+)\b/);
  if (genericBracketRound && bracket) {
    return bracket === 'losers'
      ? `Lower Bracket - Round ${genericBracketRound[1]}`
      : `Upper Bracket - Round ${genericBracketRound[1]}`;
  }

  if (normalized.includes('losers final') || normalized.includes('lower final') || normalized.includes('lb final')) {
    return 'Lower Bracket - Round 8';
  }

  if (normalized.includes('grand final')) return 'Grand Final (BO5)';

  if ((normalized.includes('winner') || normalized.includes('upper') || normalized.includes('wb')) && normalized.includes('final')) {
    return 'Upper Bracket - Round 5';
  }

  if (normalized.includes('round of 32')) return bracket === 'losers' ? 'Lower Bracket - Round 1' : 'Upper Bracket - Round 1';
  if (normalized.includes('round of 16')) return bracket === 'losers' ? 'Lower Bracket - Round 1' : 'Upper Bracket - Round 2';
  if (normalized.includes('quarter')) return bracket === 'losers' ? 'Lower Bracket - Round 2' : 'Upper Bracket - Round 3';
  if (normalized.includes('semi')) return bracket === 'losers' ? 'Lower Bracket - Round 4' : 'Upper Bracket - Round 4';
  if (normalized.includes('final')) return bracket === 'losers' ? 'Lower Bracket - Round 8' : 'Upper Bracket - Round 5';

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
    // FACEIT's championship payload uses group 1 for the upper bracket and
    // group 2 for the lower bracket, even when it omits every bracket label.
    const effectiveBracket = bracket || inferPlayoffBracketFromGroup(raw) || inferPlayoffBracketFromSchedule(round, raw);
    if (effectiveBracket === 'losers') {
      const losersNames = {
        1: 'Lower Bracket - Round 1',
        2: 'Lower Bracket - Round 2',
        3: 'Lower Bracket - Round 3',
        4: 'Lower Bracket - Round 4',
        5: 'Lower Bracket - Round 5',
        6: 'Lower Bracket - Round 6',
        7: 'Lower Bracket - Round 7',
        8: 'Lower Bracket - Round 8'
      };
      return losersNames[round] || `Lower Bracket - Round ${round}`;
    }

    if (effectiveBracket === 'winners' || !effectiveBracket) {
      const winnersNames = {
        1: 'Upper Bracket - Round 1',
        2: 'Upper Bracket - Round 2',
        3: 'Upper Bracket - Round 3',
        4: 'Upper Bracket - Round 4',
        5: 'Upper Bracket - Round 5',
        6: 'Grand Final (BO5)'
      };
      return winnersNames[round] || `Upper Bracket - Round ${round}`;
    }
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

function inferPlayoffBracketFromGroup(raw = {}) {
  const group = Number(raw.group);
  if (group === 1) return 'winners';
  if (group === 2) return 'losers';
  return '';
}

function inferPlayoffBracketFromSchedule(round, raw = {}) {
  const timestamp = Number(raw.scheduled_at);
  if (!Number.isFinite(timestamp)) return '';

  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return '';

  const dateKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);

  const lowerWindows = {
    1: ['2026-09-15', '2026-09-17'],
    2: ['2026-09-18', '2026-09-20'],
    3: ['2026-09-21', '2026-09-23'],
    4: ['2026-09-24', '2026-09-26'],
    5: ['2026-09-27', '2026-09-29'],
    6: ['2026-09-30', '2026-10-02'],
    7: ['2026-10-03', '2026-10-05'],
    8: ['2026-10-06', '2026-10-08']
  };
  const upperWindows = {
    1: ['2026-09-12', '2026-09-14'],
    2: ['2026-09-15', '2026-09-17'],
    3: ['2026-09-18', '2026-09-20'],
    4: ['2026-09-24', '2026-09-26'],
    5: ['2026-09-30', '2026-10-02']
  };

  const inLowerWindow = isDateInRange(dateKey, lowerWindows[round]);
  const inUpperWindow = isDateInRange(dateKey, upperWindows[round]);
  if (inLowerWindow && !inUpperWindow) return 'losers';
  if (inUpperWindow && !inLowerWindow) return 'winners';
  if (round === 4 && inLowerWindow && inUpperWindow) return 'losers';
  return '';
}

function isDateInRange(dateKey, range) {
  if (!range) return false;
  const [start, end] = range;
  return dateKey >= start && dateKey <= end;
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
