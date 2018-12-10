import * as levenshtein from 'fast-levenshtein';
import _ from 'lodash';
import { MatcherConfig, MatcherObject } from '.';
import { tokenise } from '../../common/nlp';

const substitutionAlphabet = 'abcdefghijklmnopqrstuvwxyz123456789';

export interface LevenshteinConfig extends MatcherConfig {
  /**
   * The maximum Levenshtein distance (inclusive).
   */
  maxDistance?: number;

  /**
   * If true, calculate the distance using entire words instead of letters.
   */
  words?: boolean;

  /**
   * If true, compare case-insensitively.
   */
  lowercase?: boolean;

  /**
   * Specifies a common alphabet in regex format (e.g. a-z0-9). Both strings
   * will be reduced to this alphabet before comparing them.
   */
  alphabet?: string;

  /**
   * If true, the first character must be identical.
   *
   * This speeds up the matching significantly (many strings can be discarded
   * before doing the Levenshtein calculation), and handles many real-world
   * use-cases better ("7 Wonders" vs "Wonders").
   *
   * Note that this comparison happens before any pre-processing (lowercase,
   * alphabet).
   */
  firstCharacterMustMatch?: boolean;
}

export interface LevenshteinCache {
  preprocess: (s: string) => string;
}

/**
 * Creates a common substitution alphabet for each word in two pieces of text
 * and substitutes the words with single characters. In simpler words, it
 * reduces a text to a single word with no whitespaces, with identical tokens
 * represented by identical letters.
 */
const substituteWords = (textA: string, textB: string) => {
  const substitutions: { [word: string]: string } = {};
  let substitutionIndex = 0;
  const tokensA = tokenise(textA);
  const tokensB = tokenise(textB);
  const tokenSet = new Set(tokensA.concat(tokensB));
  [...tokenSet].forEach(word => {
    substitutions[word] = substitutionAlphabet[substitutionIndex];
    substitutionIndex += 1;
  });
  return [
    tokensA.map(word => substitutions[word]).join(''),
    tokensB.map(word => substitutions[word]).join(''),
  ];
};

/**
 * Compares two values using Levenshtein.
 *
 * If one of the two values is an array, the other value will be compared
 * against each item of the array, and the maximum confidence is returned.
 */
const Levenshtein: MatcherObject<LevenshteinConfig, LevenshteinCache> = {
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
    // Either value is nil
    if (_.isNil(a) || _.isNil(b)) {
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

    // Check first character
    if (config.firstCharacterMustMatch === true && a[0] !== b[0]) {
      return false;
    }

    // Pre-process values
    a = cache.preprocess(a);
    b = cache.preprocess(b);

    // Values are identical
    if (a === b) {
      return 1;
    }

    // Create a single sentence-word by substituting each word with a letter
    if (config.words) {
      [a, b] = substituteWords(a, b);
    }

    // Calculate the normalised distance
    const distance = levenshtein.get(a, b);
    if (config.maxDistance === undefined || distance <= config.maxDistance) {
      return 1 - distance / Math.max(a.length, b.length);
    }
    return false;
  },
};

module.exports = { Levenshtein };
