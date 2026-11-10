import test from 'node:test';
import assert from 'node:assert/strict';

import { createFireCrownThrottle, isFireCrownMention } from '../src/fireCrown.js';

test('#FireCrown anywhere in a message, any case, counts; longer tags do not', () => {
  for (const text of ['#FireCrown', 'gg #FireCrown', '#firecrown lets go', 'what a round!! #FIRECROWN!', '(#FireCrown)']) {
    assert.equal(isFireCrownMention(text), true, text);
  }
  for (const text of ['FireCrown', '!FireCrown', '#FireCrownCount', '#FireCrowns', 'x.com/hashtag/FireCrown', '', null]) {
    assert.equal(isFireCrownMention(text), false, String(text));
  }
});

test('the bot posts #FireCrown at most once per cooldown in each channel', () => {
  const mayPost = createFireCrownThrottle(30_000);
  assert.equal(mayPost('general', 0), true, 'first one posts');
  assert.equal(mayPost('general', 5_000), false, 'within 30s: react instead');
  assert.equal(mayPost('general', 29_999), false);
  assert.equal(mayPost('match-room', 6_000), true, 'other channels have their own cooldown');
  assert.equal(mayPost('general', 30_000), true, 'after 30s it posts again');
  assert.equal(mayPost('general', 31_000), false, 'and the cooldown restarts from that post');
  // 0 seconds: every time.
  const always = createFireCrownThrottle(0);
  assert.equal(always('general', 0), true);
  assert.equal(always('general', 0), true);
});
