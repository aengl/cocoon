import _ from 'lodash';

// tslint:disable-next-line:ban-types
export function castFunction<T = Function>(fn: string | T): T {
  if (_.isString(fn)) {
    // tslint:disable-next-line:no-eval
    return eval(fn) as T;
  }
  return fn as T;
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
