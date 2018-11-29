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
   * If true, the first character must be identical.
   *
   * This speeds up the matching significantly (many strings can be discarded
   * before doing the Levenshtein calculation), and handles many real-world
   * use-cases better ("7 Wonders" vs "Wonders").
   */
  firstCharacterMustMatch?: boolean;
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
const Levenshtein: MatcherObject<LevenshteinConfig> = {
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

    // Check first character
    if (config.firstCharacterMustMatch === true && a[0] !== b[0]) {
      return false;
    }

    // Transform to lowercase
    if (config.lowercase === true) {
      a = a.toLowerCase();
      b = b.toLowerCase();
    }

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
    return 0;
  },
};

module.exports = { Levenshtein };
