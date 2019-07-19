/**
 * Ensures that an input is a regular expression, interpreting it if necessary.
 * @param pattern Can be a regular expression or a string. For strings, the
 * method will attempt to extract flags.
 * @param forceFlags Force these flags on the regular expression.
 */
export default function(pattern: string | RegExp, forceFlags = '') {
  if (isRegExp(pattern)) {
    return pattern;
  }
  const match = pattern.match(/\/(?<pattern>.+)\/(?<flags>[a-zA-Z]+)?/);
  return match !== null
    ? new RegExp(
        match.groups!.pattern,
        unique(`${match.groups!.flags || ''}${forceFlags}`)
      )
    : new RegExp(escapeRegExp(pattern), forceFlags);
}

function unique(value: string) {
  return [...new Set(value).values()].join('');
}

function isRegExp(value: any): value is RegExp {
  return value.source;
}

// From: https://github.com/lodash/lodash/blob/master/escapeRegExp.js
function escapeRegExp(s) {
  const reRegExpChar = /[\\^$.*+?()[\]{}|]/g;
  const reHasRegExpChar = RegExp(reRegExpChar.source);
  return s && reHasRegExpChar.test(s) ? s.replace(reRegExpChar, '\\$&') : s;
}
