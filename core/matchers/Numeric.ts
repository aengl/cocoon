import _ from 'lodash';
import { MatcherConfig, MatcherObject } from '.';

export interface NumericConfig extends MatcherConfig {
  /**
   * The maximum distance between the two values in percent.
   *
   * Must be larger than 0.
   */
  maxDistance: number;
}

/**
 * Compares two numbers.
 */
export const Numeric: MatcherObject<NumericConfig> = {
  match(config, cache, a, b) {
    if (_.isNil(a) || _.isNil(b)) {
      return null;
    }
    const max = Math.max(a, b);
    const distance = Math.abs(a - b) / max;
    if (distance > config.maxDistance) {
      return 0;
    }
    return 1.0 - distance / config.maxDistance;
  },
};
