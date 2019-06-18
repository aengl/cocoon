import _ from 'lodash';
import { Distance, eitherIsNil } from '.';

/**
 * This scorer simply returns the item's value as a score.
 */
export const Linear: Distance = {
  distance(config, cache, valueA, valueB) {
    return eitherIsNil(valueA, valueB)
      ? null
      : Math.abs((valueA as number) - (valueB as number));
  },
};
