import { DebugFunction } from '@cocoon/types';
import { scaleLinear } from 'd3-scale';
import _ from 'lodash';

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
  pick?(
    config: ConfigType & { [key: string]: any },
    item: object
  ): ValueType | null | undefined;

  /**
   * Creates a shared cache.
   *
   * A cache is only created once, before applying the metric to a series of
   * values, and can be used to cache expensive calculations or calculate
   * statistics across the entire range of values.
   */
  cache?(
    config: ConfigType & { [key: string]: any },
    values: Array<ValueType | null | undefined>,
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
export interface MetricDefinitions<
  ConfigType extends MetricConfig = MetricConfig
> {
  /**
   * Maps the metric name to its configuration.
   *
   * The name is meant to be a human readable identifier, for debugging
   * purposes. If the configuration doesn't specify an attribute, the name will
   * be used instead.
   */
  [name: string]: ConfigType;
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
   * Sets `ifOneMissing` and `ifBothMissing` to the same value.
   */
  ifMissing?: number;

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

export interface CrossMetricConfig extends MetricConfig {
  /**
   * The result in case only one of the values is missing.
   */
  ifOneMissing?: number;

  /**
   * The result in case both values are missing.
   */
  ifBothMissing?: number;

  /**
   * Like MetricConfig.attribute, but for the target dataset.
   */
  targetAttribute: string;
}

/**
 * An instance of a metric.
 */
export interface MetricInstance<
  ConfigType extends MetricConfig = MetricConfig
> {
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
export function createMetricsFromDefinitions<
  ConfigType extends MetricConfig = MetricConfig
>(
  definitions: MetricDefinitions<ConfigType>
): Array<MetricInstance<ConfigType>> {
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

export function applyMetric(
  instance: MetricInstance<MetricConfig>,
  data: object[],
  debug: DebugFunction
) {
  debug(`applying "${instance.name}"`, instance.config);

  const config = instance.config;
  const values = pickValues(instance, data, instance.config.attribute);
  const cache = createCache(instance, values, debug);

  // Collect metric results
  const ifMissing = config.ifMissing === undefined ? null : config.ifMissing;
  let results = values.map(v =>
    _.isNil(v) ? ifMissing : instance.obj.score(config, cache, v)
  );

  // Post-process results
  if (config.domain !== undefined || config.range !== undefined) {
    const scale = scaleLinear()
      .domain(config.domain || createDomain(instance, results))
      .range(config.range || config.domain!)
      .clamp(true);
    results = results.map(s => (_.isNil(s) ? s : scale(s)));
  }
  if (config.weight !== undefined) {
    results = results.map(s => (_.isNil(s) ? s : s * config.weight!));
  }
  return { instance, results, values };
}

export function* applyCrossMetric(
  instance: MetricInstance<CrossMetricConfig>,
  data: object[],
  target: object[],
  debug: DebugFunction
) {
  debug(`applying "${instance.name}"`, instance.config);

  const config = instance.config;
  const values = pickValues(instance, data, instance.config.attribute);
  const targetValues =
    data === target
      ? values
      : pickValues(
          instance,
          target,
          instance.config.targetAttribute || instance.config.attribute
        );
  const cache = createCache(instance, values, debug);

  // Collect metric results
  const results: MetricResult[][] = [];
  const ifOneMissing =
    config.ifMissing === undefined
      ? config.ifOneMissing || null
      : config.ifMissing;
  const ifBothMissing =
    config.ifMissing === undefined
      ? config.ifBothMissing || null
      : config.ifMissing;
  for (let i = 0; i < values.length; i++) {
    const a = values[i];
    const innerDistances: MetricResult[] = [];
    for (let j = 0; j < targetValues.length; j++) {
      const b = targetValues[j];
      innerDistances.push(
        ifBothDefined(a, b, ifOneMissing, ifBothMissing, () =>
          instance.obj.compare(instance.config, cache, a, b)
        )
      );
    }
    results.push(innerDistances);
    yield { instance, results, values };
  }

  return { instance, results, values };
}

function pickValues(
  instance: MetricInstance,
  data: object[],
  attribute?: string
) {
  return instance.obj.pick
    ? data.map(item => instance.obj.pick!(instance.config, item))
    : data.map(item => item[attribute || instance.name]);
}

function createCache(
  instance: MetricInstance<MetricConfig>,
  values: any[],
  debug: (...args: any[]) => void
) {
  return instance.obj.cache
    ? instance.obj.cache(instance.config, values, debug)
    : null;
}

function createDomain(
  instance: MetricInstance<MetricConfig>,
  values: ArrayLike<MetricResult>
) {
  const domain = [_.min(values), _.max(values)];
  if (domain.some(x => !_.isNumber(x))) {
    throw new Error(
      `metric "${instance.name}" resulted in an invalid domain: ${domain}`
    );
  }
  return domain as [number, number];
}

function ifBothDefined(
  a: any,
  b: any,
  ifOneMissing: MetricResult,
  ifBothMissing: MetricResult,
  otherwise: () => any
) {
  const aIsNil = _.isNil(a);
  const bIsNil = _.isNil(b);
  return aIsNil && bIsNil
    ? ifBothMissing
    : aIsNil || bIsNil
    ? ifOneMissing
    : otherwise();
}
