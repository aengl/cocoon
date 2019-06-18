import _ from 'lodash';
import { Scorer } from '.';

/**
 * This scorer simply returns the item's value as a score.
 */
export const Identity: Scorer = {
  score(config, cache, value) {
    return _.isNil(value) ? null : value;
  },
};
