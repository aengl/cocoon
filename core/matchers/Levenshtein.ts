import * as levenshtein from 'fast-levenshtein';
import _ from 'lodash';
import { MatcherConfig, MatcherObject } from '.';
import { tokenise } from '../nlp';

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

    // Values are identical
    if (a === b) {
      return 1;
    }

    // One of the values is an array
    const aIsArray = _.isArray(a);
    const bIsArray = _.isArray(b);
    if (aIsArray && !bIsArray) {
      return _.max((a as string[]).map(x => this.match(config, cache, x, b)));
    } else if (!aIsArray && bIsArray) {
      return _.max((b as string[]).map(x => this.match(config, cache, a, x)));
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
