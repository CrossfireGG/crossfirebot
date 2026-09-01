export function makeMatchChannelName(match) {
  const statusPrefix = makeStatusPrefix(match);
  const baseName = makeBaseMatchChannelName(match);
  return [statusPrefix, baseName].filter(Boolean).join('-').slice(0, 90);
}

export function makeBaseMatchChannelName(match) {
  const groupPrefix = makeGroupPrefix(match.group);
  const matchName = makeChannelName(`${match.teamA} vs ${match.teamB}`);
  return [groupPrefix, matchName].filter(Boolean).join('-').slice(0, 90);
}

function makeGroupPrefix(value) {
  const text = String(value || '');
  const letterMatch = text.match(/\bgroup\s*([a-z])\b/i);
  if (letterMatch) return letterMatch[1].toLowerCase();

  const numberMatch = text.match(/\bgroup\s*(\d+)\b/i);
  if (numberMatch) return numberToLetters(Number(numberMatch[1])).toLowerCase();

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

function makeChannelName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

function makeStatusPrefix(match) {
  const status = String(match.status || '').toLowerCase();
  if (['finished', 'done', 'completed', 'cancelled'].some((value) => status.includes(value))) {
    return '🟢';
  }

  if (match.scheduledByDiscord || match.scheduledAt || status === 'discord_scheduled' || status.includes('scheduled')) {
    return '🟡';
  }

  return '';
}
