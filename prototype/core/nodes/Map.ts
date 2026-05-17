import { castArray, castFunction } from '../cast-function.ts';
import type { CocoonProcessNode } from '../contract.ts';
import { trackedMap, trackedOne } from './track.ts';

/** Verbatim port of legacy `@cocoon/cocoon` Map. */
export const Map: CocoonProcessNode = {
  category: 'Data',
  description: 'Converts items in a collection using a mapping function.',

  async *process(ctx) {
    const { data, map } = ctx.ports.read() as { data: unknown; map: unknown };

    if (map) {
      const fns = castArray(map).map(m => castFunction(m)!);
      if (Array.isArray(data)) {
        ctx.ports.write({
          data: fns.reduce<unknown[]>((acc, f) => trackedMap(acc, f), data),
        });
        return `Mapped ${data.length} items`;
      }
      ctx.ports.write({
        data: fns.reduce((acc, f) => trackedOne(acc, f), data),
      });
      return 'Mapped a single item';
    }

    ctx.ports.write({ data });
    return 'No mapping applied';
  },
};
