// CF Rating: a permanent Arena rating per FACEIT account (it never resets with seasons).
// Pure functions. Everything is keyed by FACEIT player id; Discord is only for roles and display.
//
// Ratings are never edited in place. They are always the result of replaying every stored game,
// the staff adjustments and the decay in time order from the start rating (replayRatings), so
// the same data always gives the same ratings.

const DAY_MS = 24 * 60 * 60 * 1000;

// Every number can be changed in config (ARENA_RATING_* variables).
export const RATING_DEFAULTS = {
  startRating: 1000,
  kPlacement: 48,
  kNormal: 32,
  placementGames: 5,
  decayGraceDays: 7,
  decayPerDay: 5,
  decayFloor: 1000,
  decayMaxPerStretch: 100,
  rankXMinRating: 1400,
  rankXSlots: 10,
  lossProt50At: 1.30,
  lossProt75At: 1.15,
  // A short team (someone left) that loses: its remaining players lose this share.
  shortTeamMultiplier: 0.5,
  // What "playing well" is measured by for loss protection: 'hltv' (HLTV Rating 1.0, worked out
  // from the match stats) or 'adr'. A match without the numbers for HLTV falls back to ADR.
  protectionStat: 'hltv'
};

// HLTV Rating 1.0 for one player in one match, from what FACEIT's match stats give:
//   kill rating     = kills per round / 0.679
//   survival rating = rounds survived per round / 0.317
//   multi-kill      = (1K + 4*2K + 9*3K + 16*4K + 25*5K) per round / 1.277
//   rating          = (kill + 0.7 * survival + multi-kill) / 2.7
// k2..k5 are the rounds with exactly two, three, four and five kills; the rest of the kills
// came one to a round. Returns 0 when there are no rounds.
export function hltvRating({ kills = 0, deaths = 0, rounds = 0, k2 = 0, k3 = 0, k4 = 0, k5 = 0 } = {}) {
  const played = Number(rounds);
  if (!(played > 0)) return 0;
  const k1 = Math.max(0, kills - 2 * k2 - 3 * k3 - 4 * k4 - 5 * k5);
  const killRating = kills / played / 0.679;
  const survivalRating = Math.max(0, played - deaths) / played / 0.317;
  const multiKillRating = (k1 + 4 * k2 + 9 * k3 + 16 * k4 + 25 * k5) / played / 1.277;
  return Math.round(((killRating + 0.7 * survivalRating + multiKillRating) / 2.7) * 100) / 100;
}

// Whole numbers, halves away from zero (so +x.5 and -x.5 round the same way).
export function roundChange(value) {
  return Math.sign(value) * Math.round(Math.abs(value));
}

// The chance a team with this average rating beats one with that average.
export function expectedWin(teamAvg, oppAvg) {
  return 1 / (1 + 10 ** ((oppAvg - teamAvg) / 400));
}

// A losing player's share of the loss, from how they did against their own team's average
// (HLTV rating, or ADR). { multiplier, protection: 'none' | '75' | '50' }
export function lossProtection(playerValue, teamAverage, settings = RATING_DEFAULTS) {
  const value = Number(playerValue);
  const average = Number(teamAverage);
  if (!(value > 0) || !(average > 0)) return { multiplier: 1, protection: 'none', perf: null };
  const perf = value / average;
  // Compared to 4 decimals so 1.30 is 1.30 whatever the floating point says.
  const at = (threshold) => Math.round(perf * 10000) >= Math.round(threshold * 10000);
  if (at(settings.lossProt50At)) return { multiplier: 0.5, protection: '50', perf };
  if (at(settings.lossProt75At)) return { multiplier: 0.75, protection: '75', perf };
  return { multiplier: 1, protection: 'none', perf };
}

// One player's rating change for one game.
export function ratingChange({ teamAvg, oppAvg, k, won, multiplier = 1 }) {
  const expected = expectedWin(teamAvg, oppAvg);
  return won ? roundChange(k * (1 - expected)) : roundChange(-k * expected * multiplier);
}

// ---------- ranks ----------

export const RANKS = [
  { key: 'spark', name: 'Spark' },
  { key: 'ember', name: 'Ember' },
  { key: 'blaze', name: 'Blaze' },
  { key: 'inferno', name: 'Inferno' },
  { key: 'rankx', name: 'Rank X' },
  { key: 'crown', name: 'Rank X 👑' }
];
const RANK_ORDER = ['unranked', ...RANKS.map((rank) => rank.key)];

// Higher is better; 'unranked' is 0.
export function rankLevel(key) {
  return Math.max(0, RANK_ORDER.indexOf(key));
}

export function rankName(key) {
  return RANKS.find((rank) => rank.key === key)?.name || 'Unranked';
}

// The rank and division a rating is worth by itself (Rank X is decided across all players).
export function ratingTier(rating) {
  const value = Number(rating) || 0;
  const tier = (key, division) => ({ key, label: `${rankName(key)} ${division}` });
  if (value < 850) return tier('spark', 'III');
  if (value < 900) return tier('spark', 'II');
  if (value < 950) return tier('spark', 'I');
  if (value < 1000) return tier('ember', 'III');
  if (value < 1050) return tier('ember', 'II');
  if (value < 1100) return tier('ember', 'I');
  if (value < 1150) return tier('blaze', 'III');
  if (value < 1200) return tier('blaze', 'II');
  if (value < 1250) return tier('blaze', 'I');
  if (value < 1300) return tier('inferno', 'III');
  if (value < 1350) return tier('inferno', 'II');
  return tier('inferno', 'I');
}

// Everyone's rank: { [playerId]: { key, label, placing } }.
//   players: [{ id, rating, games, wins }]   banned: Set of player ids
// Placement players are Unranked ("Placing 3/5"). Rank X is the top rankXSlots ratings at or
// above rankXMinRating (ties: more wins, then more games); the first of them is Rank X 👑.
// Banned and placement players never take a Rank X slot.
export function assignRanks(players, { banned = new Set(), settings = RATING_DEFAULTS } = {}) {
  const ranks = {};
  const contenders = [];
  for (const player of players) {
    if ((player.games || 0) < settings.placementGames) {
      ranks[player.id] = { key: 'unranked', label: `Placing ${player.games || 0}/${settings.placementGames}`, placing: true };
      continue;
    }
    ranks[player.id] = { ...ratingTier(player.rating), placing: false };
    if (!banned.has(player.id) && player.rating >= settings.rankXMinRating) contenders.push(player);
  }
  contenders.sort((a, b) => b.rating - a.rating || (b.wins || 0) - (a.wins || 0) || (b.games || 0) - (a.games || 0) || String(a.id).localeCompare(String(b.id)));
  contenders.slice(0, settings.rankXSlots).forEach((player, index) => {
    ranks[player.id] = index === 0
      ? { key: 'crown', label: rankName('crown'), placing: false }
      : { key: 'rankx', label: rankName('rankx'), placing: false };
  });
  return ranks;
}

// ---------- decay ----------

// Takes the decay a player is due up to time `untilMs` (day by day) and returns the rows for
// the rating history. A player loses decayPerDay for each whole day past the grace period since
// their last rated game, never below the floor, at most decayMaxPerStretch per inactive stretch.
// Placement players and players with no games don't decay.
export function settleDecay(player, untilMs, settings = RATING_DEFAULTS) {
  const rows = [];
  if (!player.lastGameAt || player.games < settings.placementGames) return rows;
  const daysDue = Math.floor((untilMs - player.lastGameAt) / DAY_MS) - settings.decayGraceDays;
  while (player.decayDays < daysDue) {
    player.decayDays += 1;
    const amount = Math.min(settings.decayPerDay, settings.decayMaxPerStretch - player.decayed, Math.max(0, player.rating - settings.decayFloor));
    if (amount <= 0) continue;
    player.rating -= amount;
    player.decayed += amount;
    rows.push({
      playerId: player.id,
      at: player.lastGameAt + (settings.decayGraceDays + player.decayDays) * DAY_MS,
      reason: 'decay',
      change: -amount,
      after: player.rating
    });
  }
  return rows;
}

// What decay a player faces right now: { state: 'none' | 'grace' | 'decaying' | 'floor' | 'capped', daysUntil, lost }.
export function decayStatus(player, nowMs, settings = RATING_DEFAULTS) {
  if (!player?.lastGameAt || player.games < settings.placementGames) return { state: 'none' };
  if (player.rating <= settings.decayFloor) return { state: player.decayed > 0 ? 'floor' : 'none', lost: player.decayed };
  if (player.decayed >= settings.decayMaxPerStretch) return { state: 'capped', lost: player.decayed };
  const days = (nowMs - player.lastGameAt) / DAY_MS;
  if (player.decayed > 0) return { state: 'decaying', lost: player.decayed };
  return { state: 'grace', daysUntil: Math.max(0, Math.ceil(settings.decayGraceDays + 1 - days)) };
}

// ---------- the replay ----------

function newPlayer(id, settings) {
  return { id, nickname: null, rating: settings.startRating, peak: settings.startRating, games: 0, wins: 0, losses: 0, lastGameAt: null, decayDays: 0, decayed: 0 };
}

// Replays everything in time order and returns where everyone stands.
//   games: finished game records (src/arenaGames.js): { id, finishedAt, winner, teams: [{ players: [{ id, n, adr, left }] }] }
//   adjustments: staff changes: [{ at, playerId, amount, reason, staffId, staffTag }]
//   nowMs: decay is settled up to this moment
// Returns {
//   players: Map(id -> { id, nickname, rating, peak, games, wins, losses, lastGameAt, decayDays, decayed }),
//   history: [{ playerId, at, reason: 'match' | 'decay' | 'staff_adjust', change, after, matchId?, staffId?, staffTag?, note? }],
//   games:   Map(gameId -> { teamAvg: [a, b], expected: [a, b], players: { [id]: { before, after, change, k, protection, placement, gameNumber } } })
// }
export function replayRatings(games = [], adjustments = [], { nowMs = Date.now(), settings = RATING_DEFAULTS } = {}) {
  const players = new Map();
  const history = [];
  const results = new Map();
  const get = (id) => {
    if (!players.has(id)) players.set(id, newPlayer(id, settings));
    return players.get(id);
  };

  const events = [
    ...games
      .filter((game) => Number.isFinite(Date.parse(game.finishedAt || '')) && [0, 1].includes(game.winner))
      .map((game) => ({ at: Date.parse(game.finishedAt), order: 0, id: String(game.id), game })),
    ...adjustments
      .filter((entry) => entry?.playerId && Number.isFinite(Date.parse(entry.at || '')) && Number.isFinite(Number(entry.amount)))
      .map((entry, index) => ({ at: Date.parse(entry.at), order: 1, id: String(entry.id ?? index), adjustment: entry }))
  ]
    .filter((event) => event.at <= nowMs)
    .sort((a, b) => a.at - b.at || a.order - b.order || a.id.localeCompare(b.id));

  for (const event of events) {
    if (event.adjustment) {
      const entry = event.adjustment;
      const player = get(entry.playerId);
      history.push(...settleDecay(player, event.at, settings));
      const change = roundChange(Number(entry.amount));
      player.rating += change;
      player.peak = Math.max(player.peak, player.rating);
      history.push({ playerId: player.id, at: event.at, reason: 'staff_adjust', change, after: player.rating, staffId: entry.staffId || null, staffTag: entry.staffTag || null, note: entry.reason || null });
      continue;
    }

    const game = event.game;
    const teams = (game.teams || []).map((team) => (team.players || []).map((line) => ({ line, player: get(line.id) })));
    if (teams.length !== 2 || teams.some((team) => !team.length)) continue;
    // Decay first, so "rating before" is what they really had going in.
    for (const { player, line } of teams.flat()) {
      history.push(...settleDecay(player, event.at, settings));
      if (line.n) player.nickname = line.n;
    }
    const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const teamAvg = teams.map((team) => average(team.map(({ player }) => player.rating)));
    const expected = [expectedWin(teamAvg[0], teamAvg[1]), expectedWin(teamAvg[1], teamAvg[0])];
    const entry = { teamAvg: teamAvg.map((value) => Math.round(value)), expected, players: {} };

    // Every change is worked out from the "before" ratings, then they are all applied.
    const changes = [];
    teams.forEach((team, teamIndex) => {
      const won = game.winner === teamIndex;
      // How each player did against their own team's average: HLTV Rating 1.0 when the match
      // has it for the whole team, otherwise ADR.
      const stat = settings.protectionStat !== 'adr' && team.every(({ line }) => Number(line.hr) > 0) ? 'hr' : 'adr';
      const values = team.map(({ line }) => Number(line[stat])).filter((value) => value > 0);
      const teamValue = values.length === team.length ? average(values) : null;
      const short = team.some(({ line }) => line.left);
      for (const { line, player } of team) {
        const placement = player.games < settings.placementGames;
        const k = placement ? settings.kPlacement : settings.kNormal;
        let protection = { multiplier: 1, protection: 'none' };
        if (!won) {
          // A team that played short: the ones who stayed lose half, the one who left loses in full.
          if (short) protection = line.left ? { multiplier: 1, protection: 'none' } : { multiplier: settings.shortTeamMultiplier, protection: 'short' };
          else if (game.hasStats !== false && teamValue) protection = lossProtection(line[stat], teamValue, settings);
        }
        const change = ratingChange({ teamAvg: teamAvg[teamIndex], oppAvg: teamAvg[1 - teamIndex], k, won, multiplier: protection.multiplier });
        changes.push({ player, won, change, k, protection: protection.protection, placement });
      }
    });
    for (const { player, won, change, k, protection, placement } of changes) {
      const before = player.rating;
      player.rating += change;
      player.peak = Math.max(player.peak, player.rating);
      player.games += 1;
      player.wins += won ? 1 : 0;
      player.losses += won ? 0 : 1;
      player.lastGameAt = event.at;
      player.decayDays = 0;
      player.decayed = 0;
      entry.players[player.id] = { before, after: player.rating, change, k, protection, placement, gameNumber: player.games };
      history.push({ playerId: player.id, at: event.at, reason: 'match', change, after: player.rating, matchId: game.id });
    }
    results.set(game.id, entry);
  }

  for (const player of players.values()) history.push(...settleDecay(player, nowMs, settings));
  history.sort((a, b) => a.at - b.at);
  return { players, history, games: results };
}

// The numbers staff check after a recalc: how many players, the spread, how many per rank and
// the top 10.
export function ratingSummary(players, ranks, { settings = RATING_DEFAULTS, banned = new Set() } = {}) {
  const all = [...players.values()];
  const ranked = all.filter((player) => player.games >= settings.placementGames);
  const ratings = ranked.map((player) => player.rating).sort((a, b) => a - b);
  const perRank = { unranked: all.length - ranked.length };
  for (const rank of RANKS) perRank[rank.key] = 0;
  for (const player of ranked) perRank[ranks[player.id]?.key || 'unranked'] += 1;
  return {
    players: all.length,
    ranked: ranked.length,
    min: ratings[0] ?? null,
    median: ratings.length ? ratings[Math.floor((ratings.length - 1) / 2)] : null,
    max: ratings[ratings.length - 1] ?? null,
    perRank,
    top: ranked
      .filter((player) => !banned.has(player.id))
      .sort((a, b) => b.rating - a.rating || b.wins - a.wins || b.games - a.games || String(a.id).localeCompare(String(b.id)))
      .slice(0, 10)
      .map((player) => ({ id: player.id, nickname: player.nickname, rating: player.rating, wins: player.wins, losses: player.losses, rank: ranks[player.id]?.label }))
  };
}

export function ratingSummaryText(summary) {
  const ranks = [['unranked', 'Placing'], ...RANKS.map((rank) => [rank.key, rank.name])];
  return [
    `**Players:** ${summary.players} (${summary.ranked} ranked, ${summary.perRank.unranked} in placement)`,
    summary.ranked ? `**Ratings:** lowest ${summary.min} · median ${summary.median} · highest ${summary.max}` : null,
    `**Per rank:** ${ranks.map(([key, name]) => `${name} ${summary.perRank[key] || 0}`).join(' · ')}`,
    summary.top.length ? `**Top ${summary.top.length}:**\n${summary.top.map((player, index) => `${index + 1}. ${player.nickname || player.id} · ${player.rank} · ${player.rating} (${player.wins}-${player.losses})`).join('\n')}` : null
  ].filter(Boolean).join('\n');
}
