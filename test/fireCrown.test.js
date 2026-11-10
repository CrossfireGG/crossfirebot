import test from 'node:test';
import assert from 'node:assert/strict';

import { isFireCrownMention } from '../src/fireCrown.js';

test('#FireCrown anywhere in a message, any case, counts; longer tags do not', () => {
  for (const text of ['#FireCrown', 'gg #FireCrown', '#firecrown lets go', 'what a round!! #FIRECROWN!', '(#FireCrown)']) {
    assert.equal(isFireCrownMention(text), true, text);
  }
  for (const text of ['FireCrown', '!FireCrown', '#FireCrownCount', '#FireCrowns', 'x.com/hashtag/FireCrown', '', null]) {
    assert.equal(isFireCrownMention(text), false, String(text));
  }
});
