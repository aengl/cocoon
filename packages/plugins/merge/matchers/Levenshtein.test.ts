// tslint:disable:no-implicit-dependencies
import test from 'ava';
import { getMatcher } from '.';
import { LevenshteinConfig } from './Levenshtein';

const matcher = getMatcher<LevenshteinConfig>('Levenshtein');

test('matches identical values', t => {
  const config = {};
  const cache = matcher.cache!(config);
  t.is(matcher.match(config, cache, 'foo', 'foo'), 1);
});

test('calculates relative distances', t => {
  const config = {};
  const cache = matcher.cache!(config);
  t.is(matcher.match(config, cache, 'foobarbaz!', 'foobarbaz'), 0.9);
});

test('respects maximum distances', t => {
  const config = {
    maxDistance: 1,
  };
  const cache = matcher.cache!(config);
  t.is(matcher.match(config, cache, 'foo', 'foo42'), false);
  t.is(matcher.match(config, cache, 'foobarbaz!', 'foobarbaz'), 0.9);
});

test('preprocesses', t => {
  const config = {
    alphabet: 'a-z',
    lowercase: true,
  };
  const cache = matcher.cache!(config);
  t.is(matcher.match(config, cache, 'FOO bar42 baz!', 'foo bar baz'), 1);
});

test('subsitutes words', t => {
  const config = {
    words: true,
  };
  const cache = matcher.cache!(config);
  t.is(matcher.match(config, cache, 'foo bar baz qux', 'foo bar baZ Qux'), 0.5);
});

test('must match first character', t => {
  const config = {
    firstCharacterMustMatch: true,
  };
  const cache = matcher.cache!(config);
  t.is(matcher.match(config, cache, 'foo', 'Foo'), false);
});

test('finds maximum confidence in array', t => {
  const config = {};
  const cache = matcher.cache!(config);
  t.is(matcher.match(config, cache, 'foo', ['bar', 'foOO', 'baz']), 0.5);
  t.is(matcher.match(config, cache, ['foo', 'bar', 'baz'], 'baz'), 1);
});
