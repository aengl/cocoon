import _ from 'lodash';
import { Metric } from '.';

interface Cache {
  sortedValues: number[];
}

/**
 * Ranks a value, i.e. creates a numeric sequence, with 0 being the worst and 1
 * being the best rank. Duplicates, null and undefined values are ignored.
 *
 * Works only with numeric values.
 */
export const Rank: Metric<{}, Cache> = {
  cache(config, values, debug) {
    const sortedValues = _.sortedUniq(_.sortBy(values, x => x)).filter(
      x => !_.isNil(x)
    ) as number[];
    debug(`Rank: cached ${sortedValues.length} values for ranking`);
    return {
      sortedValues,
      values,
    };
  },

  score(config, cache, value) {
    const index = _.indexOf(cache.sortedValues, value);
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
