# Snapshot report for `packages/plugins/data-domain/nodes/Domain.test.ts`

The actual snapshot is saved in `Domain.test.ts.snap`.

Generated by [AVA](https://avajs.dev).

## parses data using a combined domain

> Snapshot 1

    {
      in: {
        data: [
          {
            id: 'foo',
            shop_price: 42,
            weight: 0.1,
          },
          {
            id: 'bar',
            shop_price: 23.03,
            weight: 2.42,
          },
        ],
        domain: {
          default: [
            {
              match: [
                'title',
              ],
              name: 'id',
            },
            {
              name: 'weight',
              type: 'quantity',
              unit: 'kg',
            },
          ],
          shop: [
            {
              match: [
                'price',
              ],
              name: 'shop_price',
              type: 'number',
            },
          ],
        },
        keys: [
          'default',
          'shop',
        ],
        prune: true,
      },
      out: {
        data: [
          {
            id: 'foo',
            shop_price: 42,
            weight: 0.1,
          },
          {
            id: 'bar',
            shop_price: 23.03,
            weight: 2.42,
          },
        ],
      },
    }
