/* tslint:disable:no-implicit-dependencies */
import test from 'ava';
import { getMatcher } from '.';
import { NumericConfig } from './Numeric';

const matcher = getMatcher<NumericConfig>('Numeric');

test('matches approximately', t => {
  t.is(matcher.match({ maxDistance: 1 }, null, 100, 200), 0.5);
  t.is(matcher.match({ maxDistance: 1 }, null, 200, 100), 0.5);
  t.is(matcher.match({ maxDistance: 0.5 }, null, 800, 1000), 0.6);
  t.is(matcher.match({ maxDistance: 1 }, null, 1000, 1000), 1);
  t.is(matcher.match({ maxDistance: 0.1 }, null, 1000, 900), 0);
});

test('handles null values', t => {
  t.is(matcher.match({ maxDistance: 1 }, null, null, 42), null);
  t.is(matcher.match({ maxDistance: 1 }, null, 42, null), null);
  t.is(matcher.match({ maxDistance: 1 }, null, null, null), null);
});
