import assert from 'node:assert/strict';
import test from 'node:test';
import { MessagePayload } from 'discord.js';
import { DISCORD_CONTENT_LIMIT, fitDiscordContent, installDiscordContentGuard } from '../src/discordLimits.js';

test('short message text is left alone', () => {
  assert.equal(fitDiscordContent('hello'), 'hello');
  assert.equal(fitDiscordContent('x'.repeat(DISCORD_CONTENT_LIMIT)), 'x'.repeat(DISCORD_CONTENT_LIMIT));
  assert.equal(fitDiscordContent(''), '');
});

test('long message text is cut at a line break and says how much was left out', () => {
  const lines = Array.from({ length: 200 }, (_, index) => `line ${index} ${'-'.repeat(20)}`);
  const text = lines.join('\n');
  const fitted = fitDiscordContent(text);
  assert.ok(fitted.length <= DISCORD_CONTENT_LIMIT);
  assert.ok(text.startsWith(fitted.split('\n…(')[0]), 'keeps the start of the message');
  assert.match(fitted.split('\n').at(-2), /^line \d+ -{20}$/, 'the last kept line is whole');
  const omitted = Number(fitted.match(/…\((\d+) more characters not shown/)[1]);
  assert.equal(omitted, text.length - fitted.split('\n…(')[0].length);
});

test('a code block left open by the cut is closed', () => {
  const fitted = fitDiscordContent(`\`\`\`\n${'a'.repeat(3000)}\n\`\`\``);
  assert.ok(fitted.length <= DISCORD_CONTENT_LIMIT);
  assert.equal((fitted.match(/```/g) || []).length % 2, 0);
});

test('the guard trims every outgoing message payload and reports the original length', () => {
  const trimmed = [];
  installDiscordContentGuard({ onTrim: (length) => trimmed.push(length) });
  installDiscordContentGuard({ onTrim: () => trimmed.push('installed twice') });
  const long = new MessagePayload({}, { content: 'y'.repeat(2500) }).makeContent();
  assert.ok(long.length <= DISCORD_CONTENT_LIMIT);
  assert.deepEqual(trimmed, [2500]);
  assert.equal(new MessagePayload({}, { content: 'ok' }).makeContent(), 'ok');
  assert.equal(new MessagePayload({}, { content: null }).makeContent(), '');
  assert.equal(new MessagePayload({}, {}).makeContent(), undefined);
});
