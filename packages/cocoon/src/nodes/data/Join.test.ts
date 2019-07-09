// tslint:disable:object-literal-sort-keys
import { testNode } from '@cocoon/testing';
import test from 'ava';
import { Join, Ports } from './Join';

test('joins correctly', async t => {
  const result = await testNode<Ports>(Join, {
    affluent: [{ id: 1, a: 'bar' }, { id: 3, a: 'bar' }],
    data: [{ id: 1, a: 'foo' }, { id: 2, a: 'foo' }],
    key: 'id',
  });
  t.deepEqual(result, {
    data: [{ id: 1, a: 'bar' }, { id: 2, a: 'foo' }],
  });
});

test('joins into an attribute', async t => {
  const result = await testNode<Ports>(Join, {
    affluent: [{ id: 1, a: 'bar' }, { id: 3, a: 'bar' }],
    attribute: 'b',
    data: [{ id: 1, a: 'foo' }, { id: 2, a: 'foo' }],
    key: 'id',
  });
  t.deepEqual(result, {
    data: [
      {
        id: 1,
        a: 'foo',
        b: { id: 1, a: 'bar' },
      },
      { id: 2, a: 'foo' },
    ],
  });
});

test('joins via different attributes', async t => {
  const result = await testNode<Ports>(Join, {
    affluent: [{ key: 1, a: 'bar' }, { key: 3, a: 'bar' }],
    data: [{ id: 1, a: 'foo' }, { id: 2, a: 'foo' }],
    key: ['id', 'key'],
  });
  t.deepEqual(result, {
    data: [{ id: 1, key: 1, a: 'bar' }, { id: 2, a: 'foo' }],
  });
});

test('annotate joined data', async t => {
  const result = await testNode<Ports>(Join, {
    affluent: [{ id: 1, a: 'bar' }, { id: 3, a: 'bar' }],
    annotate: { b: 'baz' },
    data: [{ id: 1, a: 'foo' }, { id: 2, a: 'foo' }],
    key: 'id',
  });
  t.deepEqual(result, {
    data: [{ id: 1, a: 'bar', b: 'baz' }, { id: 2, a: 'foo' }],
  });
});
