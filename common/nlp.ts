import _ from 'lodash';
import { castRegularExpression } from './regex';

/**
 * Detects word boundaries in a text and returns an array of individual words.
 * @param text The text to tokenise. Should be multiple words.
 */
export function tokenise(text: string) {
  return text.split(/[ ]+/);
}

/**
 * Creates a regular expression for matching a word as a token (i.e. in a
 * sentence, taking word boundaries into consideration).
 * @param pattern A word or pattern.
 * @param flags Additional flags for the regular expression.
 */
export function createTokenRegex(pattern: string, flags = '') {
  const regex = castRegularExpression(pattern);
  return new RegExp(
    `(^| )(${regex.source})($| )`,
    _.uniq((flags + regex.flags).split('')).join('')
  );
}
