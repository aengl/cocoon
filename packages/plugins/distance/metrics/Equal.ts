import _ from 'lodash';
import { Metric } from '.';

interface Config {
  penalty?: number;
}

/**
 * Checks if values are equal.
 */
export const Equal: Metric<Config, null, any> = {
  score(config, cache, v) {
    // For single values, `Equal` is an identity
    return v;
  },

  distance(config, cache, a, b) {
    const penalty = config.penalty === undefined ? 1 : config.penalty;
    if (_.isArray(a) && _.isArray(b)) {
      // In the case of comparing arrays for equality, every item that is not
      // contained in the other array multiplies the distance, which is then
      // divded by the number of items in the array.
      return (penalty * a.filter(x => b.indexOf(x) === -1).length) / a.length;
    }
    return a === b ? 0 : penalty;
  },
};
