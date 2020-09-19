// eslint-disable-next-line @typescript-eslint/ban-types
export default function <T = Function>(fn: string | T): T | undefined {
  if (typeof fn === 'string') {
    const maybeFunction = eval(fn);
    return typeof maybeFunction === 'function'
      ? (maybeFunction as T)
      : undefined;
  }
  return fn as T;
}
