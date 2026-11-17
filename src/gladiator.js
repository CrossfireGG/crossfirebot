// Gladiator: the role for people who keep playing Arena. Worked out from the finished games
// alone, by replaying them in order, so it gives the same answer whenever it is run.
//
//   earn   at least `minGames` Arena games ever, and in `earnGames` of the last `window` games
//   keep   once `missLimit` games have finished without them, a `graceDays` timer starts;
//          one game before it runs out clears it, otherwise the role is lost
//   veteran (`veteranGames` games or more): the timer starts at `veteranMissLimit` missed
//          games, and after losing the role one game brings it back
//   start  `countFromMs` is when the role was switched on. Who holds it at that moment is
//          worked out from the history by the rules above; from then on everyone's missed
//          games are counted from zero, so nobody starts with a timer already running

export const GLADIATOR_DEFAULTS = {
  minGames: 10,
  earnGames: 3,
  window: 20,
  missLimit: 20,
  graceDays: 14,
  veteranGames: 100,
  veteranMissLimit: 40
};

const DAY_MS = 86400000;
const finishedMs = (game) => Date.parse(game?.finishedAt || '') || 0;

// games: finished match records ({ finishedAt, teams: [{ players: [{ id }] }] }).
// Returns Map(playerId -> { holds, veteran, total, missed, timerEndsMs }) for everyone who
// has played. timerEndsMs is set while a holder's timer is running.
export function gladiatorStatus(games = [], { nowMs = Date.now(), countFromMs = null, settings = {} } = {}) {
  const rules = { ...GLADIATOR_DEFAULTS, ...settings };
  const ordered = games.filter((game) => finishedMs(game)).sort((a, b) => finishedMs(a) - finishedMs(b));
  const times = ordered.map(finishedMs);
  const players = new Map(); // id -> { played: [game indexes], holds, held }
  const isVeteran = (entry) => entry.played.length >= rules.veteranGames;
  // The last game before the role was switched on (-1: none, or no such moment given).
  const startIndex = countFromMs === null ? -1 : times.filter((time) => time <= countFromMs).length - 1;
  // Missed games count from a holder's last game, or from the switch-on if that is later.
  const countedFrom = (entry, fresh) => (fresh ? Math.max(entry.played.at(-1), startIndex) : entry.played.at(-1));
  // When the timer of a holder who last played game `last` started, or null if it has not.
  const timerStart = (entry, fresh = true) => {
    const index = countedFrom(entry, fresh) + (isVeteran(entry) ? rules.veteranMissLimit : rules.missLimit);
    return index < ordered.length ? times[index] : null;
  };
  const expire = (entry, atMs) => {
    const lapsed = (fresh, at) => {
      const started = timerStart(entry, fresh);
      return started !== null && at - started > rules.graceDays * DAY_MS;
    };
    // Up to the switch-on the history decides; after it, the count from zero does.
    if (entry.holds && countFromMs !== null && lapsed(false, Math.min(atMs, countFromMs))) entry.holds = false;
    if (entry.holds && (countFromMs === null || atMs > countFromMs) && lapsed(true, atMs)) entry.holds = false;
  };

  ordered.forEach((game, index) => {
    for (const team of game.teams || []) {
      for (const player of team.players || []) {
        if (!player?.id) continue;
        const entry = players.get(player.id) || { played: [], holds: false, held: false };
        players.set(player.id, entry);
        if (entry.played.length) expire(entry, times[index]);
        entry.played.push(index);
        if (entry.holds || entry.played.length < rules.minGames) continue;
        const recent = entry.played.filter((at) => at > index - rules.window).length;
        if (recent >= rules.earnGames || (entry.held && isVeteran(entry))) {
          entry.holds = true;
          entry.held = true;
        }
      }
    }
  });

  const status = new Map();
  for (const [id, entry] of players) {
    expire(entry, nowMs);
    const started = entry.holds ? timerStart(entry) : null;
    status.set(id, {
      holds: entry.holds,
      veteran: isVeteran(entry),
      total: entry.played.length,
      missed: ordered.length - 1 - countedFrom(entry, true),
      timerEndsMs: started === null ? null : started + rules.graceDays * DAY_MS
    });
  }
  return status;
}

// The ids of everyone who holds the role.
export function gladiatorIds(games, options) {
  return new Set([...gladiatorStatus(games, options)].filter(([, entry]) => entry.holds).map(([id]) => id));
}
