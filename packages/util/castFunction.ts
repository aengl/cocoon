// tslint:disable-next-line:ban-types
export default function<T = Function>(fn: string | T): T {
  if (typeof fn === 'string') {
    // tslint:disable-next-line:no-eval
    return eval(fn) as T;
  }
  return fn as T;
}
