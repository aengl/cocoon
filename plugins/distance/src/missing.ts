import _ from 'lodash';

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

export function one(config: MissingOne, v: any, otherwise: Function) {
  return _.isNil(v)
    ? config.ifMissing === undefined
      ? null
      : config.ifMissing
    : otherwise();
}

export function two(config: MissingTwo, a: any, b: any, otherwise: Function) {
  const aIsNil = _.isNil(a);
  const bIsNil = _.isNil(b);
  if (aIsNil && bIsNil) {
    const ifBothMissing =
      config.ifMissing === undefined ? config.ifBothMissing : config.ifMissing;
    return ifBothMissing === undefined ? null : ifBothMissing;
  } else if (aIsNil || bIsNil) {
    const ifOneMissing =
      config.ifMissing === undefined ? config.ifOneMissing : config.ifMissing;
    return ifOneMissing === undefined ? null : ifOneMissing;
  }
  return otherwise();
}
