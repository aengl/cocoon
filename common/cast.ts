import _ from 'lodash';

// tslint:disable-next-line:ban-types
export function castFunction<T = Function>(fn: string | T): T {
  if (_.isString(fn)) {
    // tslint:disable-next-line:no-eval
    return eval(fn) as T;
  }
  return fn as T;
}
