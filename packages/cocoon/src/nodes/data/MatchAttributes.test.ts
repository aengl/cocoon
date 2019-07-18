// tslint:disable:object-literal-sort-keys
import { testNode } from '@cocoon/testing';
import test from 'ava';
import _ from 'lodash';
import { MatchAttributes, Ports } from './MatchAttributes';

test('matches attributes', async t => {
  const data = [{ a: 'foo' }, { a: 'bar' }, { a: 'baz' }];
  t.deepEqual(
    _.omit(
      await testNode<Ports>(MatchAttributes, {
        data,
        match: {
          a: /b../,
        },
      }),
      'matches'
    ),
    {
      data,
      matched: [{ a: 'bar' }, { a: 'baz' }],
      unmatched: [{ a: 'foo' }],
    }
  );
});

test('parses regular expression', async t => {
  const data = [{ a: 'foo' }, { a: 'bar' }, { a: 'baz' }];
  t.deepEqual(
    _.omit(
      await testNode<Ports>(MatchAttributes, {
        data,
        match: {
          a: `/B../i`,
        },
      }),
      'matches'
    ),
    {
      data,
      matched: [{ a: 'bar' }, { a: 'baz' }],
      unmatched: [{ a: 'foo' }],
    }
  );
});

test('rewrites attributes', async t => {
  t.deepEqual(
    _.omit(
      await testNode<Ports>(MatchAttributes, {
        data: [{ a: 'foo' }, { a: 'bar' }, { a: 'baz' }],
        match: {
          a: /b(..)/,
        },
      }),
      'matches'
    ),
    {
      data: [{ a: 'foo' }, { a: 'ar' }, { a: 'az' }],
      matched: [{ a: 'ar' }, { a: 'az' }],
      unmatched: [{ a: 'foo' }],
    }
  );
});

test('creates new attributes', async t => {
  t.deepEqual(
    _.omit(
      await testNode<Ports>(MatchAttributes, {
        data: [{ a: 'foo' }, { a: 'bar' }],
        match: {
          a: /(?<b>.).*/,
        },
      }),
      'matches'
    ),
    {
      data: [{ a: 'foo', b: 'f' }, { a: 'bar', b: 'b' }],
      matched: [{ a: 'foo', b: 'f' }, { a: 'bar', b: 'b' }],
      unmatched: [],
    }
  );
});

test('allows multiple attributes and patterns', async t => {
  t.deepEqual(
    _.omit(
      await testNode<Ports>(MatchAttributes, {
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
    ),
    {
      data: [
        { a: 'oo', b: 'f', c: 'FOO' },
        { a: 'bar', b: 'b', c: 'BAR' },
        { a: 'baz', b: 'bAZ', c: 'BAZ' },
      ],
      matched: [{ a: 'oo', b: 'f', c: 'FOO' }, { a: 'bar', b: 'b', c: 'BAR' }],
      unmatched: [{ a: 'baz', b: 'bAZ', c: 'BAZ' }],
    }
  );
});

test('leaves original data unchanged', async t => {
  const data = [{ a: 'foo' }];
  const result = await testNode<Ports>(MatchAttributes, {
    data,
    match: {
      a: /.(..)/,
    },
  });
  t.deepEqual(_.omit(result, 'matches'), {
    data: [{ a: 'oo' }],
    matched: [{ a: 'oo' }],
    unmatched: [],
  });
  t.notDeepEqual(data, result.data);
});
