import _ from 'lodash';
import { MatcherObject } from '.';

/**
 * Finds exact matches of a value in an array.
 *
 * Either value can be an array, but not both. If a value is an array, it will
 * try to find the other value within its list of values.
 */
export const SomeExact: MatcherObject = {
  match<T = any>(config, cache, a: T | T[], b: T | T[]) {
    if (_.isArray(a)) {
      return a.some(x => _.isEqual(x, b));
    }
    if (_.isArray(b)) {
      return b.some(x => _.isEqual(x, a));
    }
    return null;
  },
};
