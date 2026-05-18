/**
 * Verbatim port of legacy `@cocoon/plugin-distance/metrics/index.ts` — the
 * metric machinery the parity-locked `Score` node composes. lodash shed to
 * `core/lodash-lite.ts`, d3-scale to the faithful `./numeric.ts` port,
 * `DebugFunction` declared locally (was `@cocoon/types`). Logic unchanged —
 * this defines ranking compatibility, do not "improve".
 */
import { scaleLinear } from './numeric.ts';
import {
  isNil,
  isNumber,
  sum,
  round,
  min as lodashMin,
  max as lodashMax,
} from '../lodash-lite.ts';
import { Custom } from './Custom.ts';
import { Decorrelate } from './Decorrelate.ts';
import { Equal } from './Equal.ts';
import { IQR } from './IQR.ts';
import { Linear } from './Linear.ts';
import { MAD } from './MAD.ts';
import { Minimum } from './Minimum.ts';
import { Percent } from './Percent.ts';
import { Rank } from './Rank.ts';
import { String } from './String.ts';
import { Test } from './Test.ts';

/** Legacy `@cocoon/types` `DebugFunction`. */
export type DebugFunction = (...args: any[]) => void;

export const metrics = {
  Custom,
  Decorrelate,
  Equal,
  IQR,
  Linear,
  MAD,
  Minimum,
  Percent,
  Rank,
  String,
  Test,
};

export type MetricResult = number | null;

/**
 * Common interface for all metrics.
 *
 * A metric produces a single, qualitative value by scoring or comparing input
 * values.
 */
export interface Metric<ConfigType = {}, CacheType = null, ValueType = number> {
  pick?(
    config: ConfigType & { [key: string]: any },
    item: object,
    attribute: string,
    affluent: boolean
  ): ValueType | null | undefined;

  cache?(
    config: ConfigType & { [key: string]: any },
    values: Array<ValueType | null | undefined>,
    debug: DebugFunction
  ): CacheType;

  score(
    config: ConfigType & { [key: string]: any },
    cache: CacheType,
    v: ValueType
  ): MetricResult;

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
  [name: string]: ConfigType;
}

/**
 * The configuration for a Cocoon metric.
 */
export interface MetricConfig {
  absolute?: boolean;
  attribute?: string;
  affluentAttribute?: string;
  domain?: [number, number];
  ifMissing?: number;
  ifOneMissing?: number;
  ifBothMissing?: number;
  invert?: boolean;
  range?: [number, number];
  type: string;
  weight?: number;
}

export interface ConsolidatedMetricConfig<
  ConfigType extends MetricConfig = MetricConfig
> {
  metrics: MetricDefinitions<ConfigType>;
  normalise?: boolean;
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
  const obj = (metrics as unknown as Record<string, Metric>)[type];
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
      obj: obj as Metric<ConfigType>,
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
  return isNil(value)
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
  const aIsNil = isNil(a);
  const bIsNil = isNil(b);
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
  let consolidated: number[] = new Array(results[0].length);
  for (let i = 0; i < consolidated.length; i++) {
    consolidated[i] = sum(results.map(res => res[i] || 0));
  }

  // Normalise the scores
  if (config.normalise) {
    const norm = scaleLinear()
      .domain([min(consolidated), max(consolidated)])
      .range([0, 1]);
    consolidated = consolidated.map(x => norm(x) as number);
  }

  if (config.precision) {
    consolidated = consolidated.map(x => round(x, config.precision));
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

export function summariseMetricResults(
  config: ConsolidatedMetricConfig,
  instances: MetricInstance[],
  metricResults: MetricResult[][],
  index: number
) {
  return metricResults.reduce(
    (acc, results, j) => ({
      ...acc,
      [instances[j].name]: limitPrecision(config, results[index]),
    }),
    {} as Record<string, MetricResult>
  );
}

function limitPrecision(
  config: ConsolidatedMetricConfig,
  result: MetricResult
) {
  return config.precision
    ? result === null
      ? result
      : round(result, config.precision)
    : result;
}

function postProcessScores(instance: MetricInstance, results: MetricResult[]) {
  const config = instance.config;
  if (config.absolute) {
    results = results.map(x => (isNil(x) ? x : Math.abs(x)));
  }
  if (config.invert !== undefined) {
    results = results.map(x => (isNil(x) ? x : -x));
  }
  if (config.domain !== undefined || config.range !== undefined) {
    const scale = scaleLinear()
      .domain(config.domain || createDomain(instance, results))
      .range(config.range || config.domain!)
      .clamp(true);
    results = results.map(x => (isNil(x) ? x : (scale(x) as number)));
  }
  if (config.weight !== undefined) {
    results = results.map(x => (isNil(x) ? x : x * config.weight!));
  }
  return results;
}

function createDomain(
  instance: MetricInstance,
  values: ArrayLike<MetricResult>
) {
  const arr = Array.from(values);
  const domain = [lodashMin(arr), lodashMax(arr)];
  if (domain.some(x => !isNumber(x))) {
    throw new Error(
      `metric "${
        instance.name
      }" resulted in an invalid domain: ${domain} (${domain.map(
        x => typeof x
      )})`
    );
  }
  return domain as [number, number];
}

function min(numbers: ArrayLike<any>) {
  const result = lodashMin(Array.from(numbers));
  if (result === undefined) {
    throw new Error(`no minimum found`);
  }
  return result;
}

function max(numbers: ArrayLike<any>) {
  const result = lodashMax(Array.from(numbers));
  if (result === undefined) {
    throw new Error(`no maximum found`);
  }
  return result;
}
