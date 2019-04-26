import test from 'ava';
import _ from 'lodash';
import { MAD } from './MAD';

const c = {
  attribute: '',
  iqr: false,
};

test('scores correctly around the median', t => {
  const cache = MAD.cache!(
    c,
    [0, 2, 3, 5, 21, 22, 22, 23, 24, 55, 100, 1000000],
    _.noop
  ); // MAD is 18
  t.is(MAD.score(c, cache, 4), -1);
  t.is(MAD.score(c, cache, 22), 0);
  t.is(MAD.score(c, cache, 40), 1);
  t.is(MAD.score(c, cache, 58), 2);
});

test('scores correctly when inverted', t => {
  const config = { ...c, invert: true };
  const cache = MAD.cache!(
    config,
    [0, 2, 3, 5, 21, 22, 22, 23, 24, 55, 100, 1000000],
    _.noop
  );
  t.is(MAD.score(config, cache, 4), 1);
  t.is(MAD.score(config, cache, 22), -0);
  t.is(MAD.score(config, cache, 40), -1);
  t.is(MAD.score(config, cache, 58), -2);
});

test('can handle null values', t => {
  const config = { ...c, invert: true };
  const cache = MAD.cache!(
    config,
    [0, 2, 3, 5, 21, null, 22, 22, 23, null, undefined, 24, 55, 100, 1000000],
    _.noop
  );
  t.is(MAD.score(config, cache, null), null);
  t.is(MAD.score(config, cache, undefined), null);
  t.is(MAD.score(config, cache, 4), 1);
  t.is(MAD.score(config, cache, 22), -0);
  t.is(MAD.score(config, cache, 40), -1);
  t.is(MAD.score(config, cache, 58), -2);
});

test('can handle distributions without variance', t => {
  const config = { ...c, invert: true };
  const cache = MAD.cache!(config, [1, 1, 1, 1, 1], _.noop);
  t.is(MAD.score(config, cache, 1), null);
  t.is(MAD.score(config, cache, 2), null);
});

test('can handle invalid values', t => {
  const cache = MAD.cache!(c, [1, 2, 23, 42], _.noop);
  t.is(MAD.score(c, cache, 'foo' as any), null);
  t.is(MAD.score(c, cache, NaN), null);
  t.is(MAD.score(c, cache, [1, 2] as any), null);
});

test('can filter outliers using iqr', t => {
  const config = { ...c, iqr: true };
  const cache = MAD.cache!(
    config,
    [-1000000, 0, 2, 3, 5, 21, 22, 22, 23, 24, 55, 1000000],
    _.noop
  );
  t.true(MAD.score(config, cache, -1000000)! > -3);
  t.true(MAD.score(config, cache, 1000000)! < 3);
});
