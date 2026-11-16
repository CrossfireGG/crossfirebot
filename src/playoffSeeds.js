export function derivePlayoffSeedMap(matches) {
  const firstRound = (matches || [])
    .filter(isUpperBracketRoundOne)
    .sort((left, right) => Number(left.bracketOrder) - Number(right.bracketOrder));
  const slots = firstRound.length * 2;
  if (slots < 2 || (slots & (slots - 1)) !== 0) return new Map();

  const bracketSeeds = standardBracketSeedOrder(slots);
  const seeds = new Map();
  firstRound.forEach((match, index) => {
    seeds.set(normalizeTeamKey(match.teamA), bracketSeeds[index * 2]);
    seeds.set(normalizeTeamKey(match.teamB), bracketSeeds[index * 2 + 1]);
  });
  return seeds;
}

export function standardBracketSeedOrder(slots) {
  if (!Number.isInteger(slots) || slots < 2 || (slots & (slots - 1)) !== 0) return [];
  let order = [1, 2];
  for (let size = 4; size <= slots; size *= 2) {
    order = order.flatMap((seed) => [seed, size + 1 - seed]);
  }
  return order;
}

function isUpperBracketRoundOne(match) {
  const round = String(match?.categoryName || match?.round || '').toLowerCase();
  if (round.includes('upper bracket') && /round\s*1\b/.test(round)) return true;
  return Number(match?.raw?.round) === 1 && Number(match?.raw?.group) === 1;
}

function normalizeTeamKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
