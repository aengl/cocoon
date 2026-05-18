/** Verbatim port of legacy `@cocoon/plugin-distance/metrics/Linear.ts`. */
import type { Metric } from './index.ts';

export interface Config {
  /**
   * When scoring, calculate the distance to this value.
   */
  value?: number;
}

/**
 * Returns the absolute difference between two numeric values.
 */
export const Linear: Metric<Config> = {
  score(config, cache, v) {
    // For single values, `Linear` is an identity unless `value` is defined
    return config.value ? v - config.value : v;
  },

  distance(config, cache, a, b) {
    return a - b;
  },
};
