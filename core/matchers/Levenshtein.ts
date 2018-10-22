import * as levenshtein from 'fast-levenshtein';
import { IMatcher, MatcherConfig } from '.';
import { tokenise } from '../tokenise';

const substitutionAlphabet = 'abcdefghijklmnopqrstuvwxyz123456789';

interface ILevenshteinConfig extends MatcherConfig {
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
 */
const Levenshtein: IMatcher<ILevenshteinConfig> = {
  match(config, a, b) {
    if (a === undefined || b === undefined) {
      return null;
    } else if (a === b) {
      return 1;
    }
    if (config.words) {
      [a, b] = substituteWords(a, b);
    }
    const distance = levenshtein.get(a, b);
    if (config.maxDistance === undefined || distance <= config.maxDistance) {
      return 1 - distance / Math.max(a.length, b.length);
    }
    return 0;
  },
};

module.exports = { Levenshtein };
