import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRequestIpMessage, parseMainStreamCommand } from '../src/streamRequest.js';

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
