import { castArray, castFunction } from './cast-function.ts';
import { trackedFilter } from './track.ts';

type FilterFn = (...args: unknown[]) => boolean;

function applyFilter(data: unknown[], filter: unknown, invert: boolean) {
  const fns = castArray(filter).map(f => castFunction<FilterFn>(f)!);
  const keep = invert ? (x: unknown) => !x : (x: unknown) => Boolean(x);
  let out = data;
  for (const f of fns)
    out = trackedFilter(out, (...args) => keep(f(...args)));
  return out;
}

/**
 * Verbatim port of legacy `@cocoon/cocoon` Filter — including the second
 * `filtered` output port (the rejected items).
 */
export const Filter = {
  category: 'Filter',
  description: 'Applies a filter function to a collection.',

  async *process(ctx) {
    const { data, filter } = ctx.ports.read() as {
      data: unknown[];
      filter: unknown;
    };

    if (filter) {
      const kept = applyFilter(data, filter, false);
      ctx.ports.write({
        data: kept,
        filtered: applyFilter(data, filter, true),
      });
      return `Filtered out ${data.length - kept.length} items`;
    }

    ctx.ports.write({ data, filtered: [] });
    return 'No filter applied';
  },
};
