import _ from 'lodash';
import {
  calculateDistance,
  calculateScore,
  createCache,
  createMetricsFromDefinitions,
  DistanceConfig,
  Metric,
  MetricDefinitions,
  MetricInstance,
  pickValue,
} from '.';

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
  pick(config, item, attribute) {
    const metrics = createMetricsFromDefinitions(config.metrics);
    return metrics.map(metric => pickValue(metric, item, attribute));
  },

  cache(config, values, debug) {
    const metrics = createMetricsFromDefinitions(config.metrics);
    return {
      caches: metrics.map(metric => createCache(metric, values, debug)),
      metrics,
    };
  },

  score(config, cache, v) {
    const min = _.min(
      cache.metrics.map((metric, i) =>
        calculateScore(metric, cache.caches[i], v[i])
      )
    );
    return min === undefined ? null : min;
  },

  distance(config, cache, a, b) {
    const min = _.min(
      cache.metrics.map((metric, i) =>
        calculateDistance(
          metric as MetricInstance<DistanceConfig>,
          cache.caches[i],
          a[i],
          b[i]
        )
      )
    );
    return min === undefined ? null : min;
  },
};
