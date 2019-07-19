import { DebugFunction } from '@cocoon/types';
import { scaleLinear } from 'd3-scale';
import _ from 'lodash';

export const metrics = _.assign(
  {},
  require('./Custom'),
  require('./Decorrelate'),
  require('./Equal'),
  require('./IQR'),
  require('./Linear'),
  require('./MAD'),
  require('./Minimum'),
  require('./Rank'),
  require('./StringSimilarity'),
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
    item: object,
    attribute: string,
    affluent: boolean
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
    debug: DebugFunction
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
  distance(
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
   * If set to true, absolute values are returned (negative values become
   * positive).
   */
  absolute?: boolean;

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
   * Like attribute, but for the affluent dataset.
   *
   * *For distance calculations only.*
   */
  affluentAttribute: string;

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
   * The result in case only one of the values is missing.
   *
   * *For distance calculations only.*
   */
  ifOneMissing?: number;

  /**
   * The result in case both values are missing.
   *
   * *For distance calculations only.*
   */
  ifBothMissing?: number;

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

export interface ConsolidatedMetricConfig<
  ConfigType extends MetricConfig = MetricConfig
> {
  /**
   * A sequence of metrics that are used to create a consolidated metric.
   */
  metrics: MetricDefinitions<ConfigType>;

  /**
   * If true, the resulting consolidated metric results are cast into a [0, 1]
   * range.
   *
   * Some technical details about this process: individual metric results of all
   * metrics are first summed up. Then, the maximum and minimum of all these
   * consolidated metric results is calculated, and they are subsequently mapped
   * into a [0, 1] range.
   *
   * This is in contrast to normalising the resulting metric result by the
   * number of metrics used and has several implications:
   * - Items with few attributes usually fare worse, even without penalties
   * - If, however, a lot of metric results are in the negative range, items
   *   with few attributes have an unfair advantage
   * - If *any* individual metric produces large values, the entire consolidated
   *   metric will be heavily shifted, which affects all items
   */
  normalise?: boolean;

  /**
   * If specified, limits the metric result's precision to a number of digits
   * after the comma.
   */
  precision?: number;
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
    return {
      config,
      name,
      obj,
      type: config.type,
    };
  });
}

export function prepareMetric(
  instance: MetricInstance,
  data: object[],
  debug: DebugFunction
) {
  const values = pickValues(instance as MetricInstance<any>, data, false);
  const cache = createCache(instance, values, debug);
  return { cache, instance, values };
}

export function prepareDistanceMetric(
  instance: MetricInstance,
  data: object[],
  affluent: object[],
  debug: DebugFunction
) {
  const values = pickValues(instance, data, false);
  const cache = createCache(instance, values, debug);
  const affluentValues =
    data === affluent ? values : pickValues(instance, affluent, true);
  return { cache, instance, values, affluentValues };
}

export function calculateScore(
  instance: MetricInstance,
  cache: any,
  value: any
) {
  return _.isNil(value)
    ? instance.config.ifMissing === undefined
      ? null
      : instance.config.ifMissing
    : instance.obj.score(instance.config, cache, value);
}

export function calculateScores(
  instance: MetricInstance,
  cache: any,
  values: any[]
) {
  return postProcessScores(
    instance,
    values.map(value => calculateScore(instance, cache, value))
  );
}

export function calculateDistance(
  instance: MetricInstance,
  cache: any,
  a: any,
  b: any
) {
  const { config } = instance;
  const aIsNil = _.isNil(a);
  const bIsNil = _.isNil(b);
  return aIsNil && bIsNil
    ? config.ifMissing === undefined
      ? config.ifBothMissing || null
      : config.ifMissing
    : aIsNil || bIsNil
    ? config.ifMissing === undefined
      ? config.ifOneMissing || null
      : config.ifMissing
    : instance.obj.distance(instance.config, cache, a, b);
}

export function calculateDistances(
  instance: MetricInstance,
  cache: any,
  value: any,
  affluentValues: any[]
) {
  const innerDistances: MetricResult[] = new Array(affluentValues.length);
  for (let i = 0; i < affluentValues.length; i++) {
    innerDistances[i] = calculateDistance(
      instance,
      cache,
      value,
      affluentValues[i]
    );
  }
  return postProcessScores(instance, innerDistances);
}

export function consolidateMetricResults(
  config: ConsolidatedMetricConfig,
  results: MetricResult[][]
) {
  // Sum up results for each metric
  let consolidated: number[] = [];
  for (let i = 0; i < results[0].length; i++) {
    consolidated.push(_.sum(results.map(res => res[i])) || 0);
  }

  // Normalise the scores
  if (config.normalise) {
    const norm = scaleLinear()
      .domain([min(consolidated), max(consolidated)])
      .range([0, 1]);
    consolidated = consolidated.map(x => norm(x));
  }

  if (config.precision) {
    consolidated = consolidated.map(x => _.round(x, config.precision));
  }

  return consolidated;
}

export function pickValue(
  instance: MetricInstance,
  item: any,
  affluent: boolean
) {
  const attribute = affluent
    ? instance.config.affluentAttribute || instance.name
    : instance.config.attribute || instance.name;
  return instance.obj.pick
    ? instance.obj.pick!(instance.config, item, attribute, affluent)
    : item[attribute];
}

export function pickValues(
  instance: MetricInstance,
  data: object[],
  affluent: boolean
) {
  return data.map(item => pickValue(instance, item, affluent));
}

export function createCache(
  instance: MetricInstance,
  values: any[],
  debug: DebugFunction
) {
  return instance.obj.cache
    ? instance.obj.cache(instance.config, values, debug)
    : null;
}

function postProcessScores(instance: MetricInstance, results: MetricResult[]) {
  const config = instance.config;
  if (config.absolute) {
    results = results.map(x => (_.isNil(x) ? x : Math.abs(x)));
  }
  if (config.domain !== undefined || config.range !== undefined) {
    const scale = scaleLinear()
      .domain(config.domain || createDomain(instance, results))
      .range(config.range || config.domain!)
      .clamp(true);
    results = results.map(x => (_.isNil(x) ? x : scale(x)));
  }
  if (config.weight !== undefined) {
    results = results.map(x => (_.isNil(x) ? x : x * config.weight!));
  }
  return results;
}

function createDomain(
  instance: MetricInstance,
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

function min(numbers: ArrayLike<any>) {
  const result = _.min(numbers);
  if (result === undefined) {
    throw new Error(`no minimum found`);
  }
  return result;
}

function max(numbers: ArrayLike<any>) {
  const result = _.max(numbers);
  if (result === undefined) {
    throw new Error(`no maximum found`);
  }
  return result;
}
