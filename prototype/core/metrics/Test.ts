/** Verbatim port of legacy `@cocoon/plugin-distance/metrics/Test.ts`.
 *  lodash → `core/lodash-lite.ts`. */
import {
  isArray,
  isFunction,
  isNil,
  isRegExp,
  isString,
  sum,
} from '../lodash-lite.ts';
import type { Metric } from './index.ts';

type Expression = string | RegExp | ((value: any) => boolean);

export interface Config {
  /**
   * An optional expression to test. There are numerous options:
   *
   * - If omitted, test if the attribute has a value.
   * - If the expression is a string, check if the string is contained.
   * - If it's regular expression, test that expression against the value.
   * - If a function is supplied, pass the value to that function and check if
   *   the returned value is truthy/falsey.
   *
   * If the tested value is an array, all values in the array are tested and
   * the reward is given if one or more tests succeed.
   */
  expression?: Expression | Expression[];

  /**
   * The score in case of a successful test. Default is 1.
   */
  reward?: number;

  /**
   * The score in case of an unsuccessful test. Default is 0.
   */
  penalty?: number;
}

/**
 * Tests an attribute value against an expression, or whether it supplies a
 * non-nil value (if no expression is specified).
 */
export const Test: Metric<Config, null, any> = {
  score(config, cache, value) {
    const expression = config.expression;
    return isArray(expression)
      ? sum(
          expression.map(x => test(value, x, config.reward, config.penalty))
        )
      : test(value, expression as Expression, config.reward, config.penalty);
  },

  distance(config, cache, a, b) {
    throw new Error(`Not implemented`);
  },
};

function test(
  value: any,
  expression: Expression,
  reward?: number,
  penalty?: number
) {
  const success = isArray(value)
    ? value.some(v => testValue(expression, v))
    : testValue(expression, value);
  if (success) {
    return reward !== undefined ? reward : 1;
  }
  return penalty !== undefined ? penalty : 0;
}

function testValue(expression: Expression, value: any) {
  if (expression === undefined) {
    return !isNil(value);
  } else if (isString(expression)) {
    return (value as string).indexOf(expression) >= 0;
  } else if (isRegExp(expression)) {
    return expression.test(value);
  } else if (isFunction(expression)) {
    return !!(expression as (value: any) => boolean)(value);
  }
  return false;
}
