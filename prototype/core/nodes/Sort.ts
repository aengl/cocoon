import { castArray } from '../cast-function.ts';
import { isNil, orderBy, partition } from '../lodash-lite.ts';
import type { CocoonProcessNode } from '../contract.ts';

/**
 * Verbatim port of legacy `@cocoon/cocoon` data/Sort — lodash shed to
 * `../lodash-lite.ts`/`../cast-function.ts`. Items missing any `orderBy`
 * attribute are partitioned out to `unsortable` (legacy behaviour); the rest
 * go through a faithful `_.orderBy` (lodash 4.17 `compareAscending`, stable),
 * so production ranking order is bit-for-bit unchanged.
 */
export const Sort: CocoonProcessNode = {
  category: 'Data',
  description: 'Sorts data.',

  async *process(context) {
    const { data, orderBy: orderByPorts, orders } = context.ports.read() as {
      data: Record<string, unknown>[];
      orderBy: string | string[];
      orders?: Array<'asc' | 'desc'>;
    };
    const attributes = castArray(orderByPorts);
    const [unsortable, unsorted] = partition(data, x =>
      attributes.some(y => isNil(x[y]))
    );
    context.ports.write({
      data: orderBy(unsorted, orderByPorts, orders),
      unsortable,
    });
    return `Sorted ${unsorted.length} items`;
  },
};
