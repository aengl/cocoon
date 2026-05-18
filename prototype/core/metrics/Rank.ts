/** Verbatim port of legacy `@cocoon/plugin-distance/metrics/Rank.ts`.
 *  lodash → `core/lodash-lite.ts`. */
import { indexOf, isNil, sortBy, sortedUniq } from '../lodash-lite.ts';
import type { Metric } from './index.ts';

interface Cache {
  sortedValues: number[];
}

/**
 * Ranks a value, i.e. creates a numeric sequence, with 0 being the worst and
 * 1 being the best rank. Duplicates, null and undefined values are ignored.
 *
 * Works only with numeric values.
 */
export const Rank: Metric<{}, Cache> = {
  cache(config, values, debug) {
    const sortedValues = sortedUniq(sortBy(values as number[], x => x)).filter(
      x => !isNil(x)
    ) as number[];
    debug(`Rank: cached ${sortedValues.length} values for ranking`);
    return {
      sortedValues,
      values,
    };
  },

  score(config, cache, value) {
    const index = indexOf(cache.sortedValues, value);
    if (index < 0) {
      // Value does not exist
      return null;
    }
    return index / (cache.sortedValues.length - 1);
  },

  distance(config, cache, a, b) {
    throw new Error(`Not implemented`);
  },
};
