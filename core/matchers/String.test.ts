/* tslint:disable:no-implicit-dependencies */
import test from 'ava-ts';
import { getMatcher } from '.';
import { StringCache, StringConfig } from './String';

const matcher = getMatcher<StringConfig, StringCache>('String');

test('matches', t => {
  const config = {};
  const cache = matcher.cache!(config);
  t.is(matcher.match(config, cache, 'foo', 'foo'), true);
  t.is(matcher.match(config, cache, 'FOO', 'foo'), false);
  t.is(matcher.match(config, cache, 'foo!', 'foo'), false);
});

test('matches with lowercase', t => {
  const config = { lowercase: true };
  const cache = matcher.cache!(config);
  t.is(matcher.match(config, cache, 'FOO', 'foo'), true);
});

test('matches with alphabet', t => {
  const config = { alphabet: 'a-z' };
  const cache = matcher.cache!(config);
  t.is(matcher.match(config, cache, 'foo!', 'foo'), true);
});

test('matches with alphabet and lowercase', t => {
  const config = { alphabet: 'a-z', lowercase: true };
  const cache = matcher.cache!(config);
  t.is(matcher.match(config, cache, 'FOO!', 'foo'), true);
});
