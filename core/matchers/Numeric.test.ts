/* tslint:disable:no-implicit-dependencies */
import test from 'ava-ts';
import { getMatcher } from '.';
import { NumericConfig } from './Numeric';

const matcher = getMatcher<NumericConfig>('Numeric');

test('matches approximately', t => {
  t.is(matcher.match({ maxDistance: 1 }, 100, 200), 0.5);
  t.is(matcher.match({ maxDistance: 1 }, 200, 100), 0.5);
  t.is(matcher.match({ maxDistance: 0.5 }, 800, 1000), 0.6);
  t.is(matcher.match({ maxDistance: 1 }, 1000, 1000), 1);
  t.is(matcher.match({ maxDistance: 0.1 }, 1000, 900), 0);
});
