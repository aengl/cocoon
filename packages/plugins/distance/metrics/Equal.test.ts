import test from 'ava';
import { Equal } from './Equal';

const c = {
  attribute: '',
  penalty: 10,
};

test('acts as an identity for single values', t => {
  t.is(Equal.score(c, null, 42), 42);
  t.is(Equal.score(c, null, -23), -23);
});

test('checks two values for equality', t => {
  t.is(Equal.distance(c, null, 0, 0), 0);
  t.is(Equal.distance(c, null, 1, 1), 0);
  t.is(Equal.distance(c, null, 23, 42), 10);
  t.is(Equal.distance(c, null, 'foo', 'foo'), 0);
  t.is(Equal.distance(c, null, 'foo', 'bar'), 10);
});

test('compares values in two arrays', t => {
  t.is(Equal.distance(c, null, [23, 'foo', 0, 2], ['foo', 1, 23, 42]), 5);
});
