import _ from 'lodash';

export { Linear } from './Linear';
export { Equal } from './Equal';

export type DistanceResult = number | null;
export type NumberOrNil = number | null | undefined;

/**
 * Common interface for all scorers.
 *
 * A scorer compares a single value to all other values of that attribute and
 * produces a single, qualitative value.
 */
export interface Distance<
  ConfigType = {},
  CacheType = null,
  ValueType = NumberOrNil
> {
  /**
   * Picks values from a data item, which will then be used in `cache()` and
   * `distance()`.
   *
   * If left undefined, the assumption is that the scorer wants the value for a
   * single attribute with the configuration name `attribute`.
   */
  pick?(config: ConfigType & { [key: string]: any }, item: object): ValueType;

  /**
   * Creates a shared cache that is passed to each invocation of `distance()`.
   *
   * If omitted, no cache is created.
   */
  cache?(
    config: ConfigType & { [key: string]: any },
    values: ValueType[],
    debug: (...args: any[]) => void
  ): CacheType;

  /**
   * Calculates the distance between two values.
   */
  distance(
    config: ConfigType & { [key: string]: any },
    cache: CacheType,
    valueA: ValueType | null | undefined,
    valueB: ValueType | null | undefined
  ): DistanceResult;
}
