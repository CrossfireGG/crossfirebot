import assert from 'node:assert/strict';
import test from 'node:test';
import { MessagePayload } from 'discord.js';
import { DISCORD_CONTENT_LIMIT, fitDiscordContent, installDiscordContentGuard, splitDiscordContent } from '../src/discordLimits.js';

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

test('long text is split between lines into messages that each fit', () => {
  const lines = Array.from({ length: 60 }, (_, index) => `\`/cf thing${index}\` - ${'help text '.repeat(5)}`);
  const text = lines.join('\n');
  const chunks = splitDiscordContent(text);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= DISCORD_CONTENT_LIMIT));
  assert.deepEqual(chunks.join('\n').split('\n'), lines, 'every line arrives whole and in order');
  assert.deepEqual(splitDiscordContent('short'), ['short']);
  assert.deepEqual(splitDiscordContent(''), []);
  const huge = splitDiscordContent('z'.repeat(4500));
  assert.deepEqual(huge.map((chunk) => chunk.length), [2000, 2000, 500]);
});

test('splitting keeps each section together when it fits', () => {
  const section = (title) => [`**${title}**`, ...Array.from({ length: 12 }, (_, index) => `${title} line ${index} ${'x'.repeat(40)}`)].join('\n');
  const sections = [section('Admin'), section('Match Room'), section('Public')];
  const text = sections.join('\n\n');
  // Room for any one section but not two: each section becomes its own message, never split.
  const limit = Math.max(...sections.map((part) => part.length)) + 10;
  const chunks = splitDiscordContent(text, limit);
  assert.deepEqual(chunks, sections);
  // Room for two: the first two share a message, the third starts the next.
  assert.deepEqual(splitDiscordContent(text, sections[0].length + sections[1].length + 2), [`${sections[0]}\n\n${sections[1]}`, sections[2]]);
});
