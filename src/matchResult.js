// Turns a finished FACEIT match (normalized by faceit.js, with `.raw`) and its /stats payload into
// the text the Google Sheet shows in the Result column, e.g.
//   "Celestial Esports won 13-7 (Mirage)"                         (BO1)
//   "Celestial Esports won 2-1 (Mirage 13-7, Inferno 10-13, Nuke 13-11)"   (BO3)
// Scores are always written winner first. Returns null when there is no winner yet.

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function prettyMapName(value) {
  const name = String(value || '').trim().replace(/^de_/i, '').replace(/_/g, ' ');
  return name ? name.replace(/\b\w/g, (letter) => letter.toUpperCase()) : '';
}

// Map scores from FACEIT match stats, oriented to the match's team A and team B.
export function extractMapScores(match, stats) {
  const raw = match?.raw || {};
  const sides = [
    { id: raw.teams?.faction1?.faction_id || null, name: match?.teamA },
    { id: raw.teams?.faction2?.faction_id || null, name: match?.teamB }
  ];
  const maps = [];
  for (const round of stats?.rounds || []) {
    const teams = round?.teams || [];
    const scoreFor = (side) => {
      const team = (side.id && teams.find((entry) => entry.team_id === side.id))
        || teams.find((entry) => normalizeName(entry?.team_stats?.Team) === normalizeName(side.name));
      const score = Number(team?.team_stats?.['Final Score']);
      return Number.isFinite(score) ? score : null;
    };
    const teamAScore = scoreFor(sides[0]);
    const teamBScore = scoreFor(sides[1]);
    if (teamAScore === null || teamBScore === null) continue;
    maps.push({ map: prettyMapName(round?.round_stats?.Map), teamAScore, teamBScore });
  }
  return maps;
}

export function buildMatchResult(match, stats = null) {
  if (!match?.teamA || !match?.teamB) return null;
  const maps = extractMapScores(match, stats);
  let teamAScore = Number.isInteger(match.teamAScore) ? match.teamAScore : null;
  let teamBScore = Number.isInteger(match.teamBScore) ? match.teamBScore : null;
  if ((teamAScore === null || teamBScore === null) && maps.length) {
    teamAScore = maps.filter((map) => map.teamAScore > map.teamBScore).length;
    teamBScore = maps.filter((map) => map.teamBScore > map.teamAScore).length;
  }
  const winnerKey = match.raw?.results?.winner;
  const aWon = winnerKey === 'faction1'
    || (winnerKey !== 'faction2' && teamAScore !== null && teamBScore !== null && teamAScore > teamBScore);
  const bWon = winnerKey === 'faction2'
    || (winnerKey !== 'faction1' && teamAScore !== null && teamBScore !== null && teamBScore > teamAScore);
  if (!aWon && !bWon) return null;

  const winner = aWon ? match.teamA : match.teamB;
  const forWinner = (a, b) => (aWon ? `${a}-${b}` : `${b}-${a}`);
  let text;
  if (maps.length === 1) {
    const [map] = maps;
    text = `${winner} won ${forWinner(map.teamAScore, map.teamBScore)}${map.map ? ` (${map.map})` : ''}`;
  } else if (maps.length > 1) {
    const series = teamAScore !== null && teamBScore !== null ? ` ${forWinner(teamAScore, teamBScore)}` : '';
    const detail = maps.map((map) => `${map.map ? `${map.map} ` : ''}${forWinner(map.teamAScore, map.teamBScore)}`).join(', ');
    text = `${winner} won${series} (${detail})`;
  } else {
    text = teamAScore !== null && teamBScore !== null ? `${winner} won ${forWinner(teamAScore, teamBScore)}` : `${winner} won`;
  }
  return { winner, teamAScore, teamBScore, maps, text };
}
