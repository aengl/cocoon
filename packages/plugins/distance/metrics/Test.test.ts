import test from 'ava';
import { Test } from './Test';

const c = {
  attribute: '',
};

test('tests whether an attribute exists', t => {
  t.is(Test.score(c, null, 42), 1);
  t.is(Test.score(c, null, 'foo'), 1);
  t.is(Test.score(c, null, 0), 1);
  t.is(Test.score(c, null, []), 0);
  t.is(Test.score(c, null, null), 0);
  t.is(Test.score(c, null, undefined), 0);
});

test('rewards and penalise', t => {
  t.is(Test.score({ ...c, reward: 23 }, null, 42), 23);
  t.is(Test.score({ ...c, penalty: -23 }, null, null), -23);
});

test('tests whether a string is contained', t => {
  t.is(Test.score({ ...c, expression: 'foo' }, null, 'foobar'), 1);
  t.is(Test.score({ ...c, expression: 'foo' }, null, 'barfoo'), 1);
  t.is(Test.score({ ...c, expression: 'foo' }, null, 'bar'), 0);
});

test('tests a regular expression', t => {
  t.is(Test.score({ ...c, expression: /fo{2}b/ }, null, 'foobar'), 1);
  t.is(Test.score({ ...c, expression: /fo{3}b/ }, null, 'foobar'), 0);
  t.is(Test.score({ ...c, expression: /^foobar$/ }, null, 'foobar'), 1);
  t.is(Test.score({ ...c, expression: /^bar$/ }, null, 'foobar'), 0);
});

test('tests a custom expression', t => {
  t.is(Test.score({ ...c, expression: x => x === 23 }, null, [23, 42]), 1);
});
