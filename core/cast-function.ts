/**
 * Cast a string `in:` param like `x => x.features` to a real function via
 * indirect-`eval`. Runs the user's own cocoon.yml in their own local core
 * process — that IS the trust model.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

export function castFunction<T = AnyFn>(fn: unknown): T | undefined {
  if (typeof fn === 'string') {
    // Indirect eval: evaluated in global scope.
    // eslint-disable-next-line no-eval
    const maybe = (0, eval)(`(${fn})`);
    return typeof maybe === 'function' ? (maybe as T) : undefined;
  }
  return typeof fn === 'function' ? (fn as T) : undefined;
}

export const castArray = <T>(v: T | T[]): T[] =>
  Array.isArray(v) ? v : v === undefined ? [] : [v];
