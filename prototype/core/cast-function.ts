/**
 * Verbatim behaviour of legacy `@cocoon/util/castFunction` + lodash
 * `castArray`. `in:` params like `x => x.features` or a multi-line
 * `x => ({ ...x.properties })` are evaluated as code. This runs the user's
 * own cocoon.yml in their own local core process — same trust model as the
 * legacy implementation (it used a bare `eval`).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

export function castFunction<T = AnyFn>(fn: unknown): T | undefined {
  if (typeof fn === 'string') {
    // Indirect eval -> evaluated in global scope, like legacy `eval(fn)`.
    // eslint-disable-next-line no-eval
    const maybe = (0, eval)(`(${fn})`);
    return typeof maybe === 'function' ? (maybe as T) : undefined;
  }
  return typeof fn === 'function' ? (fn as T) : undefined;
}

export const castArray = <T>(v: T | T[]): T[] =>
  Array.isArray(v) ? v : v === undefined ? [] : [v];
