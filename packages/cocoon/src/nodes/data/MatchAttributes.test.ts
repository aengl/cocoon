// tslint:disable:object-literal-sort-keys
import { snapshotNode } from '@cocoon/testing';
import test from 'ava';
import { MatchAttributes, Ports } from './MatchAttributes';

test('matches attributes', async t => {
  const data = [{ a: 'foo' }, { a: 'bar' }, { a: 'baz' }];
  t.snapshot(
    await snapshotNode<Ports>(MatchAttributes, {
      data,
      match: {
        a: /b../,
      },
    }),
    'matches'
  );
});

test('parses regular expression', async t => {
  const data = [{ a: 'foo' }, { a: 'bar' }, { a: 'baz' }];
  t.snapshot(
    await snapshotNode<Ports>(MatchAttributes, {
      data,
      match: {
        a: `/B../i`,
      },
    }),
    'matches'
  );
});

test('rewrites attributes', async t => {
  t.snapshot(
    await snapshotNode<Ports>(MatchAttributes, {
      data: [{ a: 'foo' }, { a: 'bar' }, { a: 'baz' }],
      match: {
        a: /b(..)/,
      },
    }),
    'matches'
  );
});

test('creates new attributes', async t => {
  t.snapshot(
    await snapshotNode<Ports>(MatchAttributes, {
      data: [{ a: 'foo' }, { a: 'bar' }],
      match: {
        a: /(?<b>.).*/,
      },
    }),
    'matches'
  );
});

test('allows multiple attributes and patterns', async t => {
  t.snapshot(
    await snapshotNode<Ports>(MatchAttributes, {
      data: [
        { a: 'foo', b: 'fOO', c: 'FOO' },
        { a: 'bar', b: 'bAR', c: 'BAR' },
        { a: 'baz', b: 'bAZ', c: 'BAZ' },
      ],
      match: {
        a: /f(oo)/,
        b: [/(.)OO/, /(.)AR/],
      },
    }),
    'matches'
  );
});

test('leaves original data unchanged', async t => {
  const data = [{ a: 'foo' }];
  const result = await snapshotNode<Ports>(MatchAttributes, {
    data,
    match: {
      a: /.(..)/,
    },
  });
  t.snapshot(result);
  t.notDeepEqual(data, result.out.data);
});
