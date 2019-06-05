import _ from 'lodash';

/**
 * Finds all matches within a string.
 *
 * Using a global regex (/../g) with `match` will not yield capture groups. This
 * function, in contrast, will.
 * @param s The string to match.
 * @param pattern The regular expression to match with.
 */
export function matchAll(s: string, pattern: RegExp) {
  if (!pattern.global) {
    throw new Error(
      'matchAll requires the regular expression to have the `g` flag'
    );
  }
  const matches: RegExpExecArray[] = [];
  let match = pattern.exec(s);
  while (match !== null) {
    matches.push(match);
    match = pattern.exec(s);
  }
  return matches;
}

/**
 * Ensures that an input is a regular expression, interpreting it if necessary.
 * @param pattern Can be a regular expression or a string. For strings, the
 * method will attempt to extract flags.
 * @param forceFlags Force these flags on the regular expression.
 */
export function castRegularExpression(
  pattern: string | RegExp,
  forceFlags = ''
) {
  if (_.isString(pattern)) {
    const match = pattern.match(/\/(?<pattern>.+)\/(?<flags>[a-zA-Z]+)?/);
    return match !== null
      ? new RegExp(
          match.groups!.pattern,
          _.uniq(`${match.groups!.flags || ''}${forceFlags}`).join('')
        )
      : new RegExp(
          pattern.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'),
          forceFlags
        );
  }
  return pattern;
}
