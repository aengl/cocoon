import _ from 'lodash';
import { Scorer } from '.';

export interface TestConfig {
  /**
   * An optional expression to test. There are numerous options:
   *
   * - If omitted, test if the attribute has a value.
   * - If the expression is a string, check if the string is contained.
   * - If it's regular expression, test that expression against the value.
   * - If a function is supplied, pass the value to that function and check if
   *   the returned value is truthy/falsey.
   *
   * If the tested value is an array, all values in the array are tested and the
   * reward is given if one or more tests succeed.
   */
  expression?: string | RegExp | ((value: any) => boolean);

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
export const Test: Scorer<TestConfig, null, any> = {
  score(config, cache, value) {
    const success = _.isArray(value)
      ? value.some(v => test(config.expression, v))
      : test(config.expression, value);
    if (success) {
      return config.reward !== undefined ? config.reward : 1;
    }
    return config.penalty !== undefined ? config.penalty : 0;
  },
};

function test(expression: TestConfig['expression'], value: any) {
  if (expression === undefined) {
    return !_.isNil(value);
  } else if (_.isString(expression)) {
    return (value as string).indexOf(expression) >= 0;
  } else if (_.isRegExp(expression)) {
    return expression.test(value);
  } else if (_.isFunction(expression)) {
    return !!expression(value);
  }
  return false;
}
