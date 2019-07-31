import _ from 'lodash';
import { Metric } from '.';

export interface Config {
  /**
   * When scoring, calculate the distance to this value.
   */
  value?: number;
}

/**
 * Returns the percent difference between two numeric values.
 */
export const Percent: Metric<Config> = {
  score(config, cache, v) {
    // For single values, `Percent` is an identity unless `value` is defined
    return config.value ? (config.value - v) / v : v;
  },

  distance(config, cache, a, b) {
    return (b - a) / a;
  },
};
