import _ from 'lodash';
import { Distance } from '.';

interface Config {
  penalty: number;
}

/**
 * Returns a fixed distance if the items are not equal.
 *
 * In the case of comparing arrays for equality, every item that is not
 * contained in the other array multiplies the distance, which is then divded by
 * the number of items in the array.
 */
export const Equal: Distance<Config, null, any> = {
  distance(config, cache, valueA, valueB) {
    if (_.isArray(valueA) && _.isArray(valueB)) {
      return (
        (config.penalty * valueA.filter(x => valueB.indexOf(x) === -1).length) /
        valueA.length
      );
    }
    return valueA === valueB ? 0 : config.penalty;
  },
};
