/* tslint:disable:no-implicit-dependencies */
import test from 'ava-ts';
import { getMatcher } from '.';

const matcher = getMatcher('Exact');

test('matches exactly', t => {
  t.is(matcher.match({}, null, 'a', 'a'), true);
  t.is(matcher.match({}, null, 'a', 'b'), false);
  t.is(matcher.match({}, null, 42, 42), true);
  t.is(matcher.match({}, null, 23, 42), false);
  t.is(matcher.match({}, null, '42', 42), false);
});
