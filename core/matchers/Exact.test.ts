/* tslint:disable:no-implicit-dependencies */
import test from 'ava-ts';
import { getMatcher } from '.';

const matcher = getMatcher('Exact');

test('matches exactly', t => {
  t.is(matcher.match({}, 'a', 'a'), true);
  t.is(matcher.match({}, 'a', 'b'), false);
  t.is(matcher.match({}, 42, 42), true);
  t.is(matcher.match({}, 23, 42), false);
  t.is(matcher.match({}, '42', 42), false);
});
