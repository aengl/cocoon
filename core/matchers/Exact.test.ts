/* tslint:disable:no-implicit-dependencies */
import test from 'ava-ts';
import { getMatcher } from '.';

const matcher = getMatcher('Exact');
const c = {
  attribute: 'test',
};

test('matches exactly', t => {
  t.is(matcher.match(c, 'a', 'a'), true);
  t.is(matcher.match(c, 'a', 'b'), false);
  t.is(matcher.match(c, 42, 42), true);
  t.is(matcher.match(c, 23, 42), false);
  t.is(matcher.match(c, '42', 42), false);
});
