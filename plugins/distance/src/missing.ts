import _ from 'lodash';
import { MetricResult } from './metrics';

export interface MissingOne {
  /**
   * The result in case the value is missing.
   */
  ifMissing?: number;
}

export interface MissingTwo {
  /**
   * Sets `ifOneMissing` and `ifBothMissing` to the same value.
   */
  ifMissing?: number;

  /**
   * The result in case only one of the values is missing.
   */
  ifOneMissing?: number;

  /**
   * The result in case both values are missing.
   */
  ifBothMissing?: number;
}

export function ifBothDefined(
  a: any,
  b: any,
  ifOneMissing: MetricResult,
  ifBothMissing: MetricResult,
  otherwise: Function
) {
  const aIsNil = _.isNil(a);
  const bIsNil = _.isNil(b);
  return aIsNil && bIsNil
    ? ifBothMissing
    : aIsNil || bIsNil
    ? ifOneMissing
    : otherwise();
}
