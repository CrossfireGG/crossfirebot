import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildRequestIpMessage, parseMainStreamCommand, parseSendIpCommand, sendIpTarget } from '../src/streamRequest.js';

test('parseMainStreamCommand accepts the main stream spellings', () => {
  assert.deepEqual(parseMainStreamCommand('!request mainstream https://www.faceit.com/en/cs2/room/1-abc'), { rest: 'https://www.faceit.com/en/cs2/room/1-abc' });
  assert.deepEqual(parseMainStreamCommand('!request main stream'), { rest: '' });
  assert.deepEqual(parseMainStreamCommand('!REQUEST Main-Stream link'), { rest: 'link' });
  assert.deepEqual(parseMainStreamCommand('!request main'), { rest: '' });
});

test('parseMainStreamCommand leaves ordinary caster requests alone', () => {
  assert.equal(parseMainStreamCommand('!request'), null);
  assert.equal(parseMainStreamCommand('!request stream'), null);
  assert.equal(parseMainStreamCommand('!request maintenance'), null);
  assert.equal(parseMainStreamCommand('!requestmainstream'), null);
});

test('main stream post puts a one-line connect command in a code span', () => {
  const text = buildRequestIpMessage({
    matchup: 'Alpha vs Bravo',
    faceitUrl: 'https://www.faceit.com/en/cs2/room/1-abc',
    value: 'connect 1.2.3.4:27020',
    enteredBy: '42',
    mainStream: true
  });
  assert.equal(text, [
    '📺 **MAIN STREAM: Alpha vs Bravo**',
    '`connect 1.2.3.4:27020`',
    'FACEIT: <https://www.faceit.com/en/cs2/room/1-abc>',
    'Entered by <@42> · main stream'
  ].join('\n'));
});

test('every other IP is posted with who it was sent to', () => {
  const text = buildRequestIpMessage({
    matchup: 'Alpha vs Bravo',
    value: 'connect 1.2.3.4:27020',
    enteredBy: '42',
    casterCount: 2,
    delivered: 1
  });
  assert.equal(text, [
    '🔌 **IP: Alpha vs Bravo**',
    '`connect 1.2.3.4:27020`',
    'Entered by <@42> · DMed to 1/2 approved caster(s)'
  ].join('\n'));
});

test('multi-line instructions are posted as written', () => {
  const text = buildRequestIpMessage({ matchup: 'A vs B', value: 'connect 1.2.3.4:27020\npassword: x' });
  assert.match(text, /\nconnect 1\.2\.3\.4:27020\npassword: x$/);
});

test('a community IP on a main stream match is labelled as the casters\' only and never pings the crew', () => {
  const text = buildRequestIpMessage({
    matchup: 'Alpha vs Bravo',
    value: 'connect 1.2.3.4:27020',
    enteredBy: '42',
    community: true,
    casterCount: 2,
    delivered: 2
  });
  assert.equal(text, [
    '🔌 **COMMUNITY: Alpha vs Bravo**',
    '`connect 1.2.3.4:27020`',
    'Entered by <@42> · community casters only, not the main stream · DMed to 2/2 approved caster(s)'
  ].join('\n'));
  assert.doesNotMatch(text, /MAIN STREAM|Crew:/);
});

test('parseSendIpCommand reads main / community after the link and keeps the rest as typed', () => {
  const link = 'https://www.faceit.com/en/cs2/room/1-abc';
  assert.deepEqual(parseSendIpCommand(`!sendip ${link} 1.2.3.4:27020`), { faceitUrl: link, target: null, deliveryText: '1.2.3.4:27020' });
  assert.deepEqual(parseSendIpCommand(`!sendip ${link} main 1.2.3.4:27020 nopw`), { faceitUrl: link, target: 'main', deliveryText: '1.2.3.4:27020 nopw' });
  assert.deepEqual(parseSendIpCommand(`!SENDIP ${link} Main Stream 1.2.3.4:27020`), { faceitUrl: link, target: 'main', deliveryText: '1.2.3.4:27020' });
  assert.deepEqual(parseSendIpCommand(`!sendip ${link} mainstream`), { faceitUrl: link, target: 'main', deliveryText: '' });
  assert.deepEqual(parseSendIpCommand(`!sendip ${link} community 1.2.3.4:27020`), { faceitUrl: link, target: 'community', deliveryText: '1.2.3.4:27020' });
  assert.deepEqual(parseSendIpCommand(`!sendip ${link} casters`), { faceitUrl: link, target: 'community', deliveryText: '' });
  assert.deepEqual(parseSendIpCommand(`!sendip ${link}`), { faceitUrl: link, target: null, deliveryText: '' });
  // Words that only start like a keyword are instructions, not a target.
  assert.deepEqual(parseSendIpCommand(`!sendip ${link} maintenance on the server\nwait 5 min`), { faceitUrl: link, target: null, deliveryText: 'maintenance on the server\nwait 5 min' });
});

test('sendIpTarget: main only when asked, or when the match is only on the main stream', () => {
  assert.equal(sendIpTarget({ requested: 'main', onMainStream: false, casterCount: 3 }), 'main');
  assert.equal(sendIpTarget({ requested: 'community', onMainStream: true, casterCount: 0 }), 'community');
  assert.equal(sendIpTarget({ onMainStream: true, casterCount: 0 }), 'main');
  assert.equal(sendIpTarget({ onMainStream: true, casterCount: 2 }), 'community');
  assert.equal(sendIpTarget({ onMainStream: false, casterCount: 0 }), 'community');
});

test('the community and main stream IPs are stored separately; IPs already posted for the crew carry over', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crossfire-two-ips-'));
  process.env.BOT_DATA_PATH = path.join(tempDir, 'bot-data.json');
  // Saved before the split: one IP per match. m-main's was posted for the crew, m-community's never was.
  await fs.writeFile(process.env.BOT_DATA_PATH, JSON.stringify({
    matchConnections: {
      'm-main': { matchId: 'm-main', type: 'cstv', value: 'connect 1.1.1.1:1' },
      'm-community': { matchId: 'm-community', type: 'cstv', value: 'connect 2.2.2.2:2' }
    },
    mainStreamCoverage: {
      'm-main': { matchId: 'm-main', ipMessageId: 'post-1' },
      'm-community': { matchId: 'm-community' }
    }
  }));
  const store = await import(`../src/store.js?two-ips=${Date.now()}`);
  try {
    assert.equal((await store.getMainStreamConnection('m-main'))?.value, 'connect 1.1.1.1:1');
    assert.equal(await store.getMainStreamConnection('m-community'), null);

    await store.saveMainStreamConnection('m-community', { type: 'cstv', value: 'connect 9.9.9.9:9' });
    assert.equal((await store.getMainStreamConnection('m-community'))?.value, 'connect 9.9.9.9:9');
    assert.equal((await store.getMatchConnection('m-community'))?.value, 'connect 2.2.2.2:2');

    await store.saveMatchConnection('m-main', { type: 'cstv', value: 'connect 3.3.3.3:3' });
    assert.equal((await store.getMatchConnection('m-main'))?.value, 'connect 3.3.3.3:3');
    assert.equal((await store.getMainStreamConnection('m-main'))?.value, 'connect 1.1.1.1:1');

    // The carry-over ran once; the saved data now has its own main stream slot.
    const saved = JSON.parse(await fs.readFile(process.env.BOT_DATA_PATH, 'utf8'));
    assert.deepEqual(Object.keys(saved.mainStreamConnections).sort(), ['m-community', 'm-main']);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('the main stream IP prompt is claimed once, and again only when forced', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crossfire-ms-prompt-'));
  process.env.BOT_DATA_PATH = path.join(tempDir, 'bot-data.json');
  const store = await import(`../src/store.js?ms-prompt=${Date.now()}`);
  try {
    await store.saveMainStreamCoverage('m1', { matchup: 'A vs B' });
    assert.ok(await store.claimMainStreamDeliveryPrompt('m1'));
    assert.equal(await store.claimMainStreamDeliveryPrompt('m1'), null);
    assert.ok(await store.claimMainStreamDeliveryPrompt('m1', true));
    assert.equal(await store.claimMainStreamDeliveryPrompt('not-on-stream', true), null);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
