import { MessagePayload } from 'discord.js';

// Discord rejects the whole message ("Invalid Form Body ... content ... Must be 2000 or fewer in
// length") when the text is longer than this.
export const DISCORD_CONTENT_LIMIT = 2000;

// Shortens message text to Discord's limit so it still sends: cuts at a line break where it can,
// closes a code block left open, and says how much was left out.
export function fitDiscordContent(text, limit = DISCORD_CONTENT_LIMIT) {
  const value = String(text ?? '');
  if (value.length <= limit) return value;
  const note = (cutCount) => `\n…(${cutCount} more characters not shown: too long for one Discord message)`;
  let kept = value.slice(0, limit - note(value.length).length - 4);
  const lastBreak = kept.lastIndexOf('\n');
  if (lastBreak > kept.length / 2) kept = kept.slice(0, lastBreak);
  if (/[\uD800-\uDBFF]$/.test(kept)) kept = kept.slice(0, -1);
  kept = kept.trimEnd();
  const omitted = value.length - kept.length;
  if ((kept.match(/```/g) || []).length % 2) kept += '\n```';
  return `${kept}${note(omitted)}`;
}

let installed = false;

// Every message the bot sends (replies, edits, follow-ups, channel posts, DMs) gets its text from
// MessagePayload#makeContent, so trimming there means no send can fail on length. `onTrim` is told
// the original length so the caller can log where it came from and fix that message properly.
export function installDiscordContentGuard({ onTrim = null } = {}) {
  if (installed) return;
  installed = true;
  const original = MessagePayload.prototype.makeContent;
  MessagePayload.prototype.makeContent = function makeContentWithinDiscordLimit() {
    const content = original.call(this);
    if (typeof content !== 'string' || content.length <= DISCORD_CONTENT_LIMIT) return content;
    try {
      onTrim?.(content.length);
    } catch {
      // Logging must never stop the message from going out.
    }
    return fitDiscordContent(content);
  };
}
