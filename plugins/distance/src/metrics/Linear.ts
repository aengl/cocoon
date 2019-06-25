import _ from 'lodash';
import { Metric } from '.';

/**
 * Returns the absolute difference between two numeric values.
 */
export const Linear: Metric = {
  score(config, cache, v) {
    return v;
  },

  compare(config, cache, a, b) {
    if (a === null) {
      return b;
    } else if (b === null) {
      return a;
    }
    return Math.abs((a as number) - (b as number));
  },
};
