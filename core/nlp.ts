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
 * @param word A word that needs to be matched in a sentence.
 * @param flags Additional flags for the regular expression.
 */
export function createTokenRegex(word: string, flags?: string) {
  return new RegExp(`(^| )(${word})($| )`, flags);
}
