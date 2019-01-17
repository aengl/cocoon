import _ from 'lodash';
import { ScorerConfig, ScorerObject } from '.';

const debug = require('../../common/debug')('core:Test');

export interface TestConfig extends ScorerConfig {
  /**
   * An optional expression to test. There are numerous options:
   *
   * - If omitted, test if the attribute has a value.
   * - If the expression is a string, check if the string is contained.
   * - If it's regular expression, test that expression against the value.
   * - If a function is supplied, pass the value to that function and check if
   *   the returned value is truthy/falsey.
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
export const Test: ScorerObject<TestConfig> = {
  score(config, cache, value) {
    let success = false;
    if (config.expression === undefined) {
      success = !_.isNil(value);
    } else if (_.isString(config.expression)) {
      success = (value as string).indexOf(config.expression) >= 0;
    } else if (_.isRegExp(config.expression)) {
      success = config.expression.test(value);
    } else if (_.isFunction(config.expression)) {
      success = !!config.expression(value);
    }
    if (success) {
      return config.reward !== undefined ? config.reward : 1;
    }
    return config.penalty !== undefined ? config.penalty : 0;
  },
};
