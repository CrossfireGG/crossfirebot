import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// The store picks its file when first loaded: point it at a temp folder first.
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crossfire-polls-'));
process.env.BOT_DATA_PATH = path.join(tempDir, 'bot-data.json');
const store = await import('../src/store.js');
const { createArenaPolls, pollCard, pollResult } = await import('../src/arenaPolls.js');

test.after(() => fs.rm(tempDir, { recursive: true, force: true }));

const HOUR = 3600000;

test('a vote result: counts, shares, the winner, a tie and nobody voting', () => {
  const poll = { question: 'Q', options: ['Yes', 'No', 'Maybe'], eligible: ['a', 'b', 'c', 'd'], votes: { a: 0, b: 0, c: 1 }, endsAt: '2026-11-20T00:00:00Z', status: 'closed' };
  const result = pollResult(poll);
  assert.deepEqual(result.rows.map((row) => row.votes), [2, 1, 0]);
  assert.deepEqual([result.total, result.eligible, result.winners], [3, 4, [0]]);
  // Each option is a bar with its share and votes, like a Discord poll.
  const bars = '**Yes**\n██████████░░░░░ 67% · 2 votes\n**No**\n█████░░░░░░░░░░ 33% · 1 vote\n**Maybe**\n░░░░░░░░░░░░░░░ 0% · 0 votes';
  assert.equal(pollCard(poll).description, `**Q**\n\n${bars}\n\nResult: **Yes**.\n-# 3 of 4 Gladiators voted.`);
  assert.match(pollCard({ ...poll, votes: { a: 0, b: 1 } }).description, /Tied: Yes and No\./);
  assert.match(pollCard({ ...poll, votes: {} }).description, /Nobody voted\./);
  // While open, the same bars show live.
  const open = pollCard({ ...poll, status: 'open' });
  assert.equal(open.open, true);
  assert.ok(open.description.includes(bars));
  assert.match(open.description, /-# 3 of 4 Gladiators have voted\.$/);
});

test('Arena votes: staff start one in the bulletin, Gladiators vote, the result shows when it closes', async () => {
  const sent = [];
  const channel = {
    id: 'bulletin',
    isTextBased: () => true,
    send: async (payload) => { const message = { id: `m${sent.length + 1}`, payload, edits: 0 }; message.edit = async (next) => { message.payload = next; message.edits += 1; }; sent.push(message); return message; },
    messages: { fetch: async (id) => sent.find((message) => message.id === id) || Promise.reject(new Error('Unknown Message')) }
  };
  const client = { channels: { fetch: async (id) => (id === 'bulletin' ? channel : null) } };
  const config = { arenaEnabled: true, arenaGladiators: true, arenaPollChannelId: 'bulletin' };
  const clock = { ms: Date.UTC(2026, 10, 17, 18) };
  const polls = createArenaPolls({ client, config, isStaff: (member) => Boolean(member?.staff), now: () => clock.ms });
  const run = async ({ as = 'staff', staff = true, sub, customId, ...options }) => {
    const replies = [];
    const interaction = {
      user: { id: as }, member: { staff }, customId,
      options: { getSubcommand: () => sub, getString: (name) => options[name] ?? null, getInteger: (name) => options[name] ?? null },
      reply: async (payload) => replies.push(payload),
      deferUpdate: async () => replies.push({ silent: true })
    };
    await (customId ? polls.handleComponent(interaction) : polls.handleCommand(interaction));
    assert.equal(replies.length, 1, 'every click and command is answered exactly once');
    if (replies[0].silent) return 'silent';
    assert.equal(replies[0].ephemeral, true, 'every reply is only for the person who asked');
    return replies[0].content;
  };
  const card = (index = 0) => sent[index].payload.embeds[0].data;
  const buttons = (index = 0) => (sent[index].payload.components[0]?.components || []).map((button) => [button.data.custom_id, button.data.label]);
  const ask = { sub: 'start', question: 'Best of 3 finals?', option1: 'Yes', option2: 'No' };

  // Only staff; and not before anyone holds the role.
  assert.match(await run({ ...ask, staff: false }), /Only Staff and Arena Admins/);
  assert.match(await run(ask), /Nobody holds the Gladiator role yet/);
  await store.saveArenaHubState({ gladiatorByDiscord: { g1: true, g2: true, g3: true } });
  assert.match(await run({ ...ask, option2: 'yes' }), /Two of the options are the same/);
  assert.equal(sent.length, 0);

  // Started: posted in the bulletin with a button per option, no pings.
  assert.equal(await run(ask), 'Vote 1 is open in <#bulletin> for 72 hours. 3 Gladiators can vote.');
  const ends = Math.floor((clock.ms + 72 * HOUR) / 1000);
  assert.equal(card().title, 'Arena vote');
  assert.equal(card().description, `**Best of 3 finals?**\n\n**Yes**\n░░░░░░░░░░░░░░░ 0% · 0 votes\n**No**\n░░░░░░░░░░░░░░░ 0% · 0 votes\n\nGladiators vote with the buttons below. One vote each, and you can change it until the vote closes <t:${ends}:R> (<t:${ends}:f>).\n-# 0 of 3 Gladiators have voted.`);
  assert.deepEqual(buttons(), [['arenapoll:1:0', 'Yes'], ['arenapoll:1:1', 'No']]);
  assert.deepEqual(sent[0].payload.allowedMentions, { parse: [] });

  // A Gladiator votes, changes it, and repeats it; the bars move with each real change.
  // A vote that counts gets no message at all.
  assert.equal(await run({ as: 'g1', customId: 'arenapoll:1:0' }), 'silent');
  assert.match(card().description, /\*\*Yes\*\*\n█{15} 100% · 1 vote\n\*\*No\*\*\n░{15} 0% · 0 votes\n[^]*-# 1 of 3 Gladiators have voted\./);
  assert.equal(await run({ as: 'g1', customId: 'arenapoll:1:1' }), 'silent');
  assert.match(card().description, /\*\*Yes\*\*\n░{15} 0% · 0 votes\n\*\*No\*\*\n█{15} 100% · 1 vote/);
  assert.equal(await run({ as: 'g1', customId: 'arenapoll:1:1' }), 'silent');
  assert.equal(sent[0].edits, 2);
  await run({ as: 'g2', customId: 'arenapoll:1:0' });
  await run({ as: 'g3', customId: 'arenapoll:1:1' });

  // Not a Gladiator; and someone who got the role after the vote opened.
  assert.match(await run({ as: 'nobody', customId: 'arenapoll:1:0' }), /^Only Gladiators can vote\./);
  await store.saveArenaHubState({ gladiatorByDiscord: { g1: true, g2: true, g3: true, late: true } });
  assert.match(await run({ as: 'late', customId: 'arenapoll:1:0' }), /after this vote opened/);
  assert.deepEqual((await store.getArenaPoll(1)).votes, { g1: 1, g2: 0, g3: 1 });

  // Staff see who voted for what; nobody else can ask.
  assert.equal(await run({ sub: 'votes' }), '**Vote 1** (open): Best of 3 finals?\n**1. Yes** (1): <@g2>\n**2. No** (2): <@g1>, <@g3>\n**Not voted** (0): nobody');
  assert.match(await run({ sub: 'votes', staff: false }), /Only Staff/);

  // Time is up: the next check closes it, shows the result and takes the buttons away.
  clock.ms += 71 * HOUR;
  await polls.tick();
  assert.equal(card().title, 'Arena vote');
  clock.ms += HOUR;
  await polls.tick();
  assert.equal(card().title, 'Arena vote: closed');
  assert.equal(card().description, '**Best of 3 finals?**\n\n**Yes**\n█████░░░░░░░░░░ 33% · 1 vote\n**No**\n██████████░░░░░ 67% · 2 votes\n\nResult: **No**.\n-# 3 of 3 Gladiators voted.');
  assert.deepEqual(sent[0].payload.components, []);
  assert.equal(await run({ as: 'g2', customId: 'arenapoll:1:1' }), 'This vote is closed.');
  assert.match(await run({ sub: 'close' }), /no open vote/);

  // A second vote, closed early by staff, and a third that is cancelled. The late Gladiator can vote now.
  assert.match(await run({ ...ask, question: 'Second?', hours: 1 }), /^Vote 2 is open in <#bulletin> for 1 hour\. 4 Gladiators can vote\.$/);
  await run({ as: 'late', customId: 'arenapoll:2:0' });
  assert.equal(await run({ sub: 'close' }), 'Vote 2 is closed and the result is posted.');
  assert.match(card(1).description, /Result: \*\*Yes\*\*\.\n-# 1 of 4 Gladiators voted\./);
  await run({ ...ask, question: 'Third?' });
  assert.equal(await run({ sub: 'cancel', id: 3 }), 'Vote 3 is cancelled.');
  assert.equal(card(2).title, 'Arena vote: cancelled');

  // The Gladiator role switched off: no votes.
  config.arenaGladiators = false;
  assert.match(await run(ask), /switched off/);
});
