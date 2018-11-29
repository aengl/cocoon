import _ from 'lodash';
import { MatcherConfig, MatcherObject } from '.';

export interface StringConfig extends MatcherConfig {
  lowercase?: boolean;
  alphabet?: string;
}

export interface StringCache {
  preprocess: (s: string) => string;
}

/**
 * Compares two strings.
 *
 * If one of the two values is an array, the other value will be compared
 * against each item of the array, and the maximum confidence is returned.
 */
// tslint:disable-next-line variable-name
const String: MatcherObject<StringConfig, StringCache> = {
  cache(config) {
    const alphabetRegex =
      config.alphabet === undefined
        ? null
        : new RegExp(`[^${config.alphabet}]`, 'g');
    const lowercase = config.lowercase === true ? s => s.toLowerCase() : s => s;
    const alphabet =
      config.alphabet === undefined
        ? s => s
        : s => s.replace(alphabetRegex, '');
    return {
      preprocess: s => alphabet(lowercase(s)),
    };
  },

  match(config, cache, a, b) {
    // Either value is undefined
    if (a === undefined || b === undefined) {
      return null;
    }

    // One of the values is an array
    const aIsArray = _.isArray(a);
    const bIsArray = _.isArray(b);
    if (aIsArray && !bIsArray) {
      return _.max((a as string[]).map(x => this.match(config, cache, x, b)));
    } else if (!aIsArray && bIsArray) {
      return _.max((b as string[]).map(x => this.match(config, cache, a, x)));
    }

    // Compare strings
    return cache.preprocess(a) === cache.preprocess(b);
  },
};

module.exports = { String };
