import test from 'ava';
import _ from 'lodash';
import { Rank } from './Rank';

const c = {};

test('ranks correctly', t => {
  const cache = Rank.cache!(c, [4, 2, 3, 2, 42, 23], _.noop);
  t.is(Rank.score(c, cache, 2), 0);
  t.is(Rank.score(c, cache, 23), 0.75);
  t.is(Rank.score(c, cache, 42), 1);
});

test('handles null values', t => {
  const cache = Rank.cache!(
    c,
    [4, 2, undefined, null, 3, 2, 42, null, 23],
    _.noop
  );
  t.is(Rank.score(c, cache, 2), 0);
  t.is(Rank.score(c, cache, 23), 0.75);
  t.is(Rank.score(c, cache, 42), 1);
});

test('handle non-existent values', t => {
  const cache = Rank.cache!(c, [4, 2, 42], _.noop);
  t.is(Rank.score(c, cache, 23), null);
});
