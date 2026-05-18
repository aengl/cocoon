/** Verbatim port of legacy `@cocoon/plugin-distance/metrics/Minimum.ts`.
 *  lodash → `core/lodash-lite.ts`. */
import { min } from '../lodash-lite.ts';
import {
  calculateDistance,
  calculateScore,
  createCache,
  createMetricsFromDefinitions,
  pickValue,
} from './index.ts';
import type { Metric, MetricDefinitions, MetricInstance } from './index.ts';

export interface Cache {
  metrics: MetricInstance[];
  caches: any[];
}

export interface Config {
  metrics: MetricDefinitions;
}

/**
 * A meta-metric that picks the minimum distance from its sub-metrics.
 */
export const Minimum: Metric<Config, Cache, any[]> = {
  pick(config, item, attribute, affluent) {
    const metrics = createMetricsFromDefinitions(config.metrics);
    return metrics.map(metric => pickValue(metric, item, affluent));
  },

  cache(config, values, debug) {
    const metrics = createMetricsFromDefinitions(config.metrics);
    return {
      caches: metrics.map(metric => createCache(metric, values, debug)),
      metrics,
    };
  },

  score(config, cache, v) {
    const result = min(
      cache.metrics.map((metric, i) =>
        calculateScore(metric, cache.caches[i], v[i])
      )
    );
    return result === undefined ? null : result;
  },

  distance(config, cache, a, b) {
    const result = min(
      cache.metrics.map((metric, i) =>
        calculateDistance(metric, cache.caches[i], a[i], b[i])
      )
    );
    return result === undefined ? null : result;
  },
};
