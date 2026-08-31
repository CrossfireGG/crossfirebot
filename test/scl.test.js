import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { SclApiError, SclClient } from '../src/scl.js';
import { channelNameMatchesSclTeams, findUniqueSclMatchChannel } from '../src/sclChannelResolver.js';
import { verifySclWebhook } from '../src/webhookServer.js';

const secret = 'test-webhook-secret';

function jwt(payload, algorithm = 'HS256') {
  const header = Buffer.from(JSON.stringify({ alg: algorithm, typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

test('accepts a current HS256 token from SCL', () => {
  const token = jwt({ iss: 'scl', iat: Math.floor(Date.now() / 1000) });
  assert.doesNotThrow(() => verifySclWebhook(`Bearer ${token}`, secret));
});

test('rejects a token that does not declare HS256', () => {
  const token = jwt({ iss: 'scl', iat: Math.floor(Date.now() / 1000) }, 'none');
  assert.throws(() => verifySclWebhook(`Bearer ${token}`, secret), (error) => error.statusCode === 401);
});

test('rejects a token older than 15 seconds', () => {
  const token = jwt({ iss: 'scl', iat: Math.floor(Date.now() / 1000) - 16 });
  assert.throws(() => verifySclWebhook(`Bearer ${token}`, secret), (error) => error.statusCode === 401);
});

test('unwraps a successful SCL match response', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    success: true,
    data: { match_id: 'match-1', maps: [] }
  }), { status: 200 }));

  const result = await new SclClient('api-key').getFaceitMatch('match-1');
  assert.equal(result.match_id, 'match-1');
});

test('marks 5xx and network errors retryable', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    error: { code: 'UPSTREAM_ERROR', message: 'try later' }
  }), { status: 503 }));

  await assert.rejects(
    () => new SclClient('api-key').getFaceitMatch('match-1'),
    (error) => error instanceof SclApiError && error.retryable && error.status === 503
  );
});

test('treats 401, 403, and 404 SCL errors as terminal', async (context) => {
  for (const [status, code] of [[401, '401'], [403, 'MATCH_NOT_IN_SCOPE'], [404, 'MATCH_NOT_FOUND']]) {
    context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
      error: { code, message: 'terminal' }
    }), { status }));

    await assert.rejects(
      () => new SclClient('api-key').getFaceitMatch('match-1'),
      (error) => error instanceof SclApiError && !error.retryable && error.code === code
    );
    context.mock.restoreAll();
  }
});

test('matches group-prefixed Discord channels to SCL team names', () => {
  assert.equal(
    channelNameMatchesSclTeams('a-raisedbypixels-vs-overtake', ['raisedbypixels', 'Overtake']),
    true
  );
  assert.equal(
    channelNameMatchesSclTeams('🟡-a-overtake-sector-vs-raisedbypixels', ['raisedbypixels', 'Overtake']),
    true
  );
});

test('uses a channel-name fallback only when the match is unique', () => {
  const channels = [
    { id: '1', name: 'a-raisedbypixels-vs-overtake', isTextBased: () => true },
    { id: '2', name: 'a-other-team-vs-someone-else', isTextBased: () => true }
  ];
  assert.equal(findUniqueSclMatchChannel(channels, ['raisedbypixels', 'Overtake']).channel?.id, '1');

  channels.push({ id: '3', name: 'b-overtake-vs-raisedbypixels', isTextBased: () => true });
  const ambiguous = findUniqueSclMatchChannel(channels, ['raisedbypixels', 'Overtake']);
  assert.equal(ambiguous.channel, null);
  assert.equal(ambiguous.matchCount, 2);
});
