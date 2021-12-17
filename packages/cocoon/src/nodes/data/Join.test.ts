import { snapshotNode } from '@cocoon/testing';
import test from 'ava';
import { Join, Ports } from './Join';

test('joins correctly', async t => {
  t.snapshot(
    await snapshotNode<Ports>(Join, {
      affluent: [
        { id: 1, a: 'bar' },
        { id: 3, a: 'bar' },
      ],
      data: [
        { id: 1, a: 'foo' },
        { id: 2, a: 'foo' },
      ],
      key: 'id',
    })
  );
});

test('joins into an attribute', async t => {
  t.snapshot(
    await snapshotNode<Ports>(Join, {
      affluent: [
        { id: 1, a: 'bar' },
        { id: 3, a: 'bar' },
      ],
      attribute: 'b',
      data: [
        { id: 1, a: 'foo' },
        { id: 2, a: 'foo' },
      ],
      key: 'id',
    })
  );
});

test('ignores nil values', async t => {
  t.snapshot(
    await snapshotNode<Ports>(Join, {
      affluent: [
        { id: 1, a: undefined },
        { id: 2, a: null },
      ],
      data: [
        { id: 1, a: 'foo' },
        { id: 2, a: 'foo' },
      ],
      key: 'id',
    })
  );
});

test('joins via different attributes', async t => {
  t.snapshot(
    await snapshotNode<Ports>(Join, {
      affluent: [
        { key: 1, a: 'bar' },
        { key: 3, a: 'bar' },
      ],
      data: [
        { id: 1, a: 'foo' },
        { id: 2, a: 'foo' },
      ],
      key: ['id', 'key'],
    })
  );
});

test('annotates joined data', async t => {
  t.snapshot(
    await snapshotNode<Ports>(Join, {
      affluent: [
        { id: 1, a: 'bar' },
        { id: 3, a: 'bar' },
      ],
      annotate: { b: 'baz' },
      data: [
        { id: 1, a: 'foo' },
        { id: 2, a: 'foo' },
      ],
      key: 'id',
    })
  );
});
