import test from 'ava';
import _ from 'lodash';
import { Custom } from './Custom';

test(`picks the entire item`, t => {
  t.deepEqual(Custom.pick!({}, { foo: 23 }, '', false), { foo: 23 });
});

test(`can calculate custom score`, t => {
  const config = {
    score: x => x * 2,
  };
  const cache = Custom.cache!(config, [], _.noop);
  t.is(Custom.score(config, cache, 42), 84);
});

test(`can parse score function`, t => {
  const config = {
    score: `x => x * 2`,
  };
  const cache = Custom.cache!(config, [], _.noop);
  t.is(Custom.score(config, cache, 42), 84);
});

test(`can do custom comparison`, t => {
  const config = {
    compare: (a, b) => a + b,
  };
  const cache = Custom.cache!(config, [], _.noop);
  t.is(Custom.distance(config, cache, 23, 42), 65);
});

test(`can parse compare function`, t => {
  const config = {
    compare: `(a, b) => a + b`,
  };
  const cache = Custom.cache!(config, [], _.noop);
  t.is(Custom.distance(config, cache, 23, 42), 65);
});
