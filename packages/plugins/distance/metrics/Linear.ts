import _ from 'lodash';
import { Metric } from '.';

export interface Config {
  /**
   * When scoring, calculate the distance to this value.
   */
  value?: number;
}

/**
 * Returns the absolute difference between two numeric values.
 */
export const Linear: Metric = {
  score(config, cache, v) {
    // For single values, `Linear` is an identity unless `value` is defined
    return config.value ? v - config.value : v;
  },

  compare(config, cache, a, b) {
    return a - b;
  },
};
