// tslint:disable:object-literal-sort-keys
import { testNode } from '@cocoon/testing';
import test from 'ava';
import { Sort, Ports } from './Sort';

test('sorts correctly', async t => {
  t.deepEqual(
    await testNode<Ports>(Sort, {
      data: [{ a: 2 }, { a: 1 }],
      orderBy: 'a',
    }),
    {
      data: [{ a: 1 }, { a: 2 }],
      unsortable: [],
    }
  );
  t.deepEqual(
    await testNode<Ports>(Sort, {
      data: [{ a: 2 }, { a: 1 }],
      orderBy: 'a',
      orders: ['desc'],
    }),
    {
      data: [{ a: 2 }, { a: 1 }],
      unsortable: [],
    }
  );
  t.deepEqual(
    await testNode<Ports>(Sort, {
      data: [{ a: 2, b: 1 }, { a: 1, b: 2 }, { a: 1, b: 1 }],
      orderBy: ['a', 'b'],
      orders: ['asc', 'desc'],
    }),
    {
      data: [{ a: 1, b: 2 }, { a: 1, b: 1 }, { a: 2, b: 1 }],
      unsortable: [],
    }
  );
});

test('partitions unsortable data', async t => {
  t.deepEqual(
    await testNode<Ports>(Sort, {
      data: [{ a: 2 }, { a: 1 }, { b: 1 }],
      orderBy: 'a',
    }),
    {
      data: [{ a: 1 }, { a: 2 }],
      unsortable: [{ b: 1 }],
    }
  );
});
