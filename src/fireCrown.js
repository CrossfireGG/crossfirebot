// #FireCrown: the bot answers any message that says #FireCrown (any case, anywhere in the message),
// but not a longer tag that starts with it, like #FireCrownCount or #FireCrowns.
export function isFireCrownMention(content) {
  return /#firecrown(?![a-z0-9_])/i.test(String(content || ''));
}
