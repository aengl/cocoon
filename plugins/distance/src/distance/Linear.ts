import _ from 'lodash';
import { Distance } from '.';

/**
 * Returns the absolute difference between two numeric values.
 */
export const Linear: Distance = {
  distance(config, cache, valueA, valueB) {
    return Math.abs((valueA as number) - (valueB as number));
  },
};
