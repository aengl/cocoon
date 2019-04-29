import _ from 'lodash';
import { MatcherObject } from '.';

/**
 * Exact-matches two values.
 */
export const Exact: MatcherObject = {
  match<T = any>(config, cache, a: T, b: T) {
    return _.isEqual(a, b);
  },
};
