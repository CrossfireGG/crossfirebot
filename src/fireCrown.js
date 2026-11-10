// #FireCrown: the bot answers any message that says #FireCrown (any case, anywhere in the message),
// but not a longer tag that starts with it, like #FireCrownCount or #FireCrowns.
export function isFireCrownMention(content) {
  return /#firecrown(?![a-z0-9_])/i.test(String(content || ''));
}

// Keeps the bot from flooding a channel: it may post #FireCrown in a channel at most once per
// `cooldownMs`. Returns a function (channelId, now) -> true when the bot may post now. Every use
// still counts and gets a 🔥 reaction either way.
export function createFireCrownThrottle(cooldownMs) {
  const lastPostAt = new Map();
  return (channelId, now = Date.now()) => {
    const last = lastPostAt.get(channelId);
    if (last !== undefined && now - last < cooldownMs) return false;
    lastPostAt.set(channelId, now);
    return true;
  };
}
