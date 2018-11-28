import _ from 'lodash';
import { MatcherConfig, MatcherObject, MatcherResult } from '.';

export interface StringConfig extends MatcherConfig {
  lowercase?: boolean;
  alphabet?: string;
}

/**
 * Compares two strings.
 *
 * If one of the two values is an array, the other value will be compared
 * against each item of the array, and the maximum confidence is returned.
 */
// tslint:disable-next-line variable-name
const String: MatcherObject<StringConfig> = {
  match(config, a, b): MatcherResult {
    // Either value is undefined
    if (a === undefined || b === undefined) {
      return null;
    }

    // One of the values is an array
    const aIsArray = _.isArray(a);
    const bIsArray = _.isArray(b);
    if (aIsArray && !bIsArray) {
      return _.max((a as string[]).map(x => this.match(config, x, b)));
    } else if (!aIsArray && bIsArray) {
      return _.max((b as string[]).map(x => this.match(config, a, x)));
    }

    // Lowercase
    if (config.lowercase === true) {
      a = a.toLowerCase();
      b = b.toLowerCase();
    }

    // Alphabet
    if (config.alphabet !== undefined) {
      const regex = new RegExp(`[^${config.alphabet}]`, 'g');
      a = a.replace(regex, '');
      b = b.replace(regex, '');
    }

    // Compare strings
    return a === b;
  },
};

module.exports = { String };
