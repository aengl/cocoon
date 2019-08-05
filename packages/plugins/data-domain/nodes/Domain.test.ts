import { snapshotNode } from '@cocoon/testing';
import test from 'ava';
import { Domain, Ports } from './Domain';

test('parses data using a combined domain', async t => {
  t.snapshot(
    await snapshotNode<Ports>(Domain, {
      data: [
        {
          price: '42.00€',
          title: 'foo',
          weight: '100g',
        },
        {
          price: '23,03 EUR',
          title: 'bar',
          weight: '2.42kg',
        },
      ],
      domain: {
        default: [
          { name: 'id', match: ['title'] },
          { name: 'weight', type: 'quantity', unit: 'kg' },
        ],
        shop: [{ name: 'shop_price', type: 'number', match: ['price'] }],
      },
      keys: ['default', 'shop'],
      prune: true,
    })
  );
});
