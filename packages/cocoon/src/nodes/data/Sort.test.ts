// tslint:disable:object-literal-sort-keys
import { snapshotNode } from '@cocoon/testing';
import test from 'ava';
import { Ports, Sort } from './Sort';

test('partitions unsortable data', async t => {
  t.snapshot(
    await snapshotNode<Ports>(Sort, {
      data: [{ a: 2 }, { a: 1 }, { b: 1 }],
      orderBy: 'a',
    })
  );
});

test('sorts correctly', async t => {
  t.snapshot(
    await snapshotNode<Ports>(Sort, {
      data: [{ a: 2 }, { a: 1 }],
      orderBy: 'a',
    })
  );
  t.snapshot(
    await snapshotNode<Ports>(Sort, {
      data: [{ a: 2 }, { a: 1 }],
      orderBy: 'a',
      orders: ['desc'],
    })
  );
  t.snapshot(
    await snapshotNode<Ports>(Sort, {
      data: [{ a: 2, b: 1 }, { a: 1, b: 2 }, { a: 1, b: 1 }],
      orderBy: ['a', 'b'],
      orders: ['asc', 'desc'],
    })
  );
});
