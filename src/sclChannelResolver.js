function compact(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function stripStatusPrefix(value) {
  return String(value || '')
    .replace(/^(?:🟡|🟢|v)-/i, '')
    .replace(/^(?:scheduled|finished)-/i, '');
}

function teamNameMatches(channelPart, teamName) {
  const channelTeam = compact(channelPart);
  const sclTeam = compact(teamName);
  if (!channelTeam || !sclTeam) return false;
  if (channelTeam === sclTeam) return true;

  const shorterLength = Math.min(channelTeam.length, sclTeam.length);
  return shorterLength >= 5 && (channelTeam.includes(sclTeam) || sclTeam.includes(channelTeam));
}

export function channelNameMatchesSclTeams(channelName, teamNames) {
  if (!Array.isArray(teamNames) || teamNames.length < 2) return false;

  const normalized = stripStatusPrefix(channelName).toLowerCase();
  const separatorIndex = normalized.indexOf('-vs-');
  if (separatorIndex < 0) return false;

  let left = normalized.slice(0, separatorIndex);
  const right = normalized.slice(separatorIndex + 4);
  left = left.replace(/^[a-z]-/, '');

  return (
    teamNameMatches(left, teamNames[0]) && teamNameMatches(right, teamNames[1])
  ) || (
    teamNameMatches(left, teamNames[1]) && teamNameMatches(right, teamNames[0])
  );
}

export function findUniqueSclMatchChannel(channels, teamNames) {
  const matches = [...channels].filter((channel) =>
    channel?.isTextBased?.() && channelNameMatchesSclTeams(channel.name, teamNames)
  );
  return {
    channel: matches.length === 1 ? matches[0] : null,
    matchCount: matches.length
  };
}
