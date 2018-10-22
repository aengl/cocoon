import * as _ from 'lodash';
import { IMatcher } from '.';

/**
 * Exact-matches two values.
 */
const Exact: IMatcher = {
  match(_0, a, b) {
    return _.isEqual(a, b);
  },
};

module.exports = { Exact };
