import * as _ from 'lodash';
import { MatcherObject } from '.';

/**
 * Exact-matches two values.
 */
const Exact: MatcherObject = {
  match(_0, a, b) {
    return _.isEqual(a, b);
  },
};

module.exports = { Exact };
