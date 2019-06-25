import _ from 'lodash';
import { MissingOne } from '../missing';

export const metrics = _.assign(
  {},
  require('./Decorrelate'),
  require('./Equal'),
  require('./IQR'),
  require('./Linear'),
  require('./MAD'),
  require('./Rank'),
  require('./Test')
);

export type MetricResult = number | null;

/**
 * Common interface for all metrics.
 *
 * A metric compares produces a single, qualitative value by scoring or
 * comparing input values.
 */
export interface Metric<ConfigType = {}, CacheType = null, ValueType = number> {
  /**
   * Picks values from a data item.
   *
   * If left undefined it will be up to the Cocoon node to decide which value to
   * pick. In most cases, an implementation is not needed.
   */
  pick?(config: ConfigType & { [key: string]: any }, item: object): ValueType;

  /**
   * Creates a shared cache.
   *
   * A cache is only created once, before applying the metric to a series of
   * values, and can be used to cache expensive calculations or calculate
   * statistics across the entire range of values.
   */
  cache?(
    config: ConfigType & { [key: string]: any },
    values: ValueType[],
    debug: (...args: any[]) => void
  ): CacheType;

  /**
   * Evaluates a single value.
   *
   * Effectively that means turning a value into a number with well-defined
   * semantics, based on the type of metric used (e.g. determining a score).
   */
  score(
    config: ConfigType & { [key: string]: any },
    cache: CacheType,
    v: ValueType
  ): MetricResult;

  /**
   * Calculates the distance between two values.
   *
   * The meaning of that distance depends on the type of metric used. Numbers
   * close to zero indicate that the two values are similar.
   */
  compare(
    config: ConfigType & { [key: string]: any },
    cache: CacheType,
    a: ValueType,
    b: ValueType
  ): MetricResult;
}

/**
 * Metrics as defined in the definitions file.
 */
export interface MetricDefinitions<Missing extends MissingOne = MissingOne> {
  /**
   * Maps the metric name to its configuration.
   *
   * The name is meant to be a human readable identifier, for debugging
   * purposes. If the configuration doesn't specify an attribute, the name will
   * be used instead.
   */
  [name: string]: MetricConfig & Missing;
}

/**
 * The configuration for a Cocoon metric.
 */
export interface MetricConfig {
  /**
   * The name of the attribute that is scored.
   *
   * Scorers may define a different way of picking data via their `pick()`
   * function, in which case this configuration is ignored.
   *
   * If omitted and no `pick()` function exists for the metric, the name of the
   * metric definition will be used instead (see `MetricDefinitions`).
   */
  attribute?: string;

  /**
   * Defines the range of valid metric results. Values that fall outside of this
   * domain will be clamped.
   *
   * See: https://github.com/d3/d3-scale#continuous_domain
   */
  domain?: [number, number];

  /**
   * Defines the range that metric results will be mapped into.
   *
   * See: https://github.com/d3/d3-scale#continuous_range
   */
  range?: [number, number];

  /**
   * The metric type.
   */
  type: string;

  /**
   * Determines to what degree this metric factors into for the consolidated
   * result.
   */
  weight?: number;
}

/**
 * An instance of a metric.
 */
export interface MetricInstance<ConfigType = MetricConfig> {
  config: ConfigType;
  name: string;
  obj: Metric<ConfigType>;
  type: string;
}

/**
 * Looks up the corresponding metric by its type name.
 */
export function getMetric(type: string): Metric {
  const obj = metrics[type];
  if (!obj) {
    throw new Error(`invalid metric: ${type}`);
  }
  return obj;
}

/**
 * Creates instances of all metrics in the definitions.
 */
export function createMetricsFromDefinitions(
  definitions: MetricDefinitions
): MetricInstance[] {
  return Object.keys(definitions).map(name => {
    const config = definitions[name];
    const obj = getMetric(config.type);
    // validateInstance(config, obj);
    return {
      config,
      name,
      obj,
      type: config.type,
    };
  });
}

// function validateInstance(config: MetricConfig, obj: Metric) {
//   if (!obj.pick && !config.attribute) {
//     throw new Error(
//       `attribute configuration missing for scorer "${config.type}"`
//     );
//   }
// }
