export { Decorrelate } from './Decorrelate';
export { Identity } from './Identity';
export { IQR } from './IQR';
export { MAD } from './MAD';
export { Rank } from './Rank';
export { Test } from './Test';

export type ScorerResult = number | null;
export type NumberOrNil = number | null | undefined;

/**
 * Common interface for all scorers.
 *
 * A scorer compares a single value to all other values of that attribute and
 * produces a single, qualitative value.
 */
export interface Scorer<
  ConfigType = {},
  CacheType = null,
  ValueType = NumberOrNil
> {
  /**
   * Picks values from a data item, which will then be used in `cache()` and
   * `score()`.
   *
   * If left undefined, the assumption is that the scorer wants the value for a
   * single attribute with the configuration name `attribute`.
   */
  pick?(config: ConfigType & { [key: string]: any }, item: object): ValueType;

  /**
   * Creates a shared cache that is passed to each invocation of `score()`.
   *
   * If omitted, no cache is created.
   */
  cache?(
    config: ConfigType & { [key: string]: any },
    values: ValueType[],
    debug: (...args: any[]) => void
  ): CacheType;

  /**
   * Scores a value by comparing it to all other values.
   */
  score(
    config: ConfigType & { [key: string]: any },
    cache: CacheType,
    value: ValueType | null | undefined
  ): ScorerResult;
}
