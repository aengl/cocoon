import test from 'ava';
import _ from 'lodash';
import { Decorrelate } from './Decorrelate';

const c = {
  attributes: ['a', 'b'],
};

test('picks the correct values', t => {
  t.deepEqual(Decorrelate.pick!(c, { a: 23, b: 42 }, '', false), [23, 42]);
});

test('returns identity for bias-free correlations', t => {
  const cache = Decorrelate.cache!(
    c,
    [[0, 0], [0.2, 1], [0.4, 2], [0.6, 3], [0.8, 4], [1, 5]],
    _.noop
  );
  t.is(Decorrelate.score(c, cache, [0, 0]), 0);
  t.is(Decorrelate.score(c, cache, [0.2, 1]), 0.2);
  t.is(Decorrelate.score(c, cache, [1, 5]), 1);
});

test('handles null', t => {
  const cache = Decorrelate.cache!(
    c,
    [
      [0, 0],
      [0.2, 1],
      [0.4, 2],
      [0.6, 3],
      [0.8, 4],
      [1, 5],
      [null, 100],
      [100, null],
    ],
    _.noop
  );
  t.is(Decorrelate.score(c, cache, [null, 1]), null);
  t.is(Decorrelate.score(c, cache, [1, null]), 1);
});

test('handles null with default', t => {
  const cache = Decorrelate.cache!(
    {
      ...c,
      default: 3,
    },
    [[0, 0], [0.2, 1], [0.4, 2], [0.6, 3], [0.8, 4], [1, 5]],
    _.noop
  );
  t.is(Decorrelate.score(c, cache, [null, 1]), null);
  t.is(Decorrelate.score(c, cache, [0, null]), -0.30000000000000004);
  t.is(Decorrelate.score(c, cache, [0.6, null]), 0.5999999999999999);
  t.is(Decorrelate.score(c, cache, [1, null]), 1.2);
});

test('removes bias', t => {
  const cache = Decorrelate.cache!(
    c,
    [
      [0, 0],
      [0.2, 1],
      [0.4, 2],
      [0.6, 3],
      [0.8, 4],
      [1, 5],
      // bias higher b-values
      [0, 1],
      [0, 2],
      [1, 4],
      [1, 5],
    ],
    _.noop
  );
  // Original values are adjusted, so that a-values are higher for low b-values,
  // and vise-versa
  t.is(Decorrelate.score(c, cache, [0, 0]), 0.0622775800711744);
  t.is(Decorrelate.score(c, cache, [0.4, 2]), 0.4309608540925267);
  t.is(Decorrelate.score(c, cache, [0.6, 3]), 0.6153024911032028);
  t.is(Decorrelate.score(c, cache, [1, 5]), 0.9839857651245552);
  // A low a-value for a high b-value will be penalised severely
  t.is(Decorrelate.score(c, cache, [0, 5]), -0.5160142348754448);
  // And vise-versa
  t.is(Decorrelate.score(c, cache, [1, 0]), 1.5622775800711743);
});
