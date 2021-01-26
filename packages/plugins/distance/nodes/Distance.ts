import { CocoonNode } from '@cocoon/types';
import _ from 'lodash';
import { join } from 'path';
import { promises as fs } from 'fs';
import {
  calculateDistances,
  ConsolidatedMetricConfig,
  consolidateMetricResults,
  createMetricsFromDefinitions,
  MetricResult,
  prepareDistanceMetric,
  summariseMetricResults,
} from '../metrics';

export interface Ports extends ConsolidatedMetricConfig {
  affluent?: Record<string, unknown>[];
  attribute?: string;
  data: Record<string, unknown>[];
  cacheKey?: string;
  distance?: number;
  key?: string;
  limit: number;
}

interface DistanceInfo {
  $distance: number;
  $metrics: {
    [name: string]: MetricResult;
  };
  key?: string;
}

export const Distance: CocoonNode<Ports> = {
  category: 'Data',
  description: `Calculates a distance between all items of one or two collections, based on custom distance.`,

  in: {
    affluent: {
      description:
        'If supplied, calculate distances between the data and the affluent data set.',
    },
    attribute: {
      description: `Name of the new attribute the score is written to.`,
      visible: false,
    },
    data: {
      clone: true,
      description: `The data for which to calculate distances.`,
      required: true,
    },
    cacheKey: {
      description: `If set, uses this attribute to cache the results.`,
      visible: false,
    },
    distance: {
      description: `The maximum allowed distance.`,
      visible: false,
    },
    key: {
      description: `The primary key to reference items with the lowest distance in the results with. If left undefined, the entire item will be added to the data.`,
      visible: false,
    },
    limit: {
      defaultValue: 10,
      description: `The distance node will only keep the n most similar items, which is determined by the limit configuration.`,
      visible: false,
    },
    metrics: {
      description: `Configures the distance metrics.`,
      visible: false,
    },
    normalise: {
      description: `If true, the resulting consolidated distances are cast into a [0, 1 range.`,
      visible: false,
    },
    precision: {
      description: `If specified, limits the distance precision to a number of digits after the comma.`,
      visible: false,
    },
  },

  out: {
    data: {},
  },

  async *process(context) {
    const ports = context.ports.read();
    const {
      attribute,
      cacheKey,
      data,
      distance: maxDistance,
      key,
      limit,
      metrics: metricDefinitions,
    } = ports;
    const { debug } = context;
    const affluent = ports.affluent || data;

    // Open or create cache
    const cachePath = join(
      context.cocoonFile.cache,
      `${context.graphNode.id}_lookup.json`
    );
    let cache: Record<string, DistanceInfo[]> = {};
    if (cacheKey) {
      try {
        cache = JSON.parse(await fs.readFile(cachePath, 'utf-8'));
        yield `Checking cache integrity`;
        // Remove stale items from cache
        const keySet = new Set(data.map(x => _.get(x, cacheKey)));
        for (const [k, v] of Object.entries(cache)) {
          if (!keySet.has(k)) {
            debug(`Removed stale item from cache: ${k}`);
            delete cache[k];
          }
          if (v.some(x => !keySet.has(x.key))) {
            debug(`Removed item with stale key from cache: ${k}`);
            delete cache[k];
          }
        }
      } catch (error) {
        debug('cache error:', error);
        cache = {}; // Ignore missing/invalid cache
      }
    }

    // Create and cache metrics
    const metrics = createMetricsFromDefinitions(metricDefinitions);
    const metricData = metrics.map(metric =>
      prepareDistanceMetric(metric, data, affluent, context.debug)
    );

    // If we're not using affluent data, the item will be compared to itself,
    // which we want to avoid. This function filters the case where the indices
    // of outer and inner iterations are equal.
    const filterItself = affluent === data ? (i, j) => i !== j : () => true;

    // Calculate distances
    for (let i = 0; i < data.length; i++) {
      const cacheKeyForItem = cacheKey
        ? (_.get(data[i], cacheKey) as string)
        : undefined;
      let distances = cacheKeyForItem ? cache[cacheKeyForItem] : undefined;

      // Calculate distances for current item
      if (!distances) {
        const results = metricData.map(metric =>
          calculateDistances(
            metric.instance,
            metric.cache,
            metric.values[i],
            metric.affluentValues
          )
        );

        // Consolidate metric results
        const consolidated = consolidateMetricResults(ports, results);

        // Find the `n` most similar items
        distances = indexForTopN(
          consolidated,
          limit,
          (x, j) => filterItself(i, j) && (maxDistance ? x < maxDistance : true)
        ).reduce<DistanceInfo[]>((acc, j) => {
          acc.push({
            $distance: consolidated[j],
            $metrics: summariseMetricResults(ports, metrics, results, j),
            ...(key ? { key: _.get(affluent[j], key) } : affluent[j]),
          });
          return acc;
        }, []);
      }

      // Cache and assign distances
      if (cacheKey) {
        cache[_.get(data[i], cacheKey) as string] = distances;
      }
      data[i] = {
        ...data[i],
        [attribute || 'related']: distances,
      };

      yield [`Calculated distances for ${i} items`, i / data.length];
    }

    // Persist cache
    await fs.writeFile(cachePath, JSON.stringify(cache));

    context.ports.write({ data });
    return `Calculated distances for ${data.length} items`;
  },
};

/**
 * Returns the n indices of the largest elements, in descending order.
 */
export function indexForTopN(
  values: number[],
  limit: number,
  filter: (x: number, i: number) => boolean
) {
  return _.sortBy(
    values.map((v, i) => ({ i, v })),
    x => x.v
  )
    .filter(x => filter(x.v, x.i))
    .slice(0, limit)
    .map(x => x.i);
}
