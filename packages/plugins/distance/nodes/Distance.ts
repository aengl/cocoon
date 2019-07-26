import { CocoonNode } from '@cocoon/types';
import _ from 'lodash';
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
  affluent?: object[];
  attribute?: string;
  data: object[];
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
  },

  out: {
    data: {},
    distances: {},
  },

  async *process(context) {
    const ports = context.ports.read();
    const {
      attribute,
      data,
      distance: maxDistance,
      key,
      limit,
      metrics: metricDefinitions,
    } = ports;
    const affluent = ports.affluent || data;

    // Create and cache metrics
    const metrics = createMetricsFromDefinitions(metricDefinitions);
    const metricData = metrics.map(metric =>
      prepareDistanceMetric(metric, data, affluent, context.debug)
    );

    // Calculate distances
    for (let i = 0; i < data.length; i++) {
      // Calculate distances for current item
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
      const distanceAttribute = attribute || 'related';
      data[i][distanceAttribute] = indexForTopN(
        consolidated,
        limit,
        // Filter the current item (don't consider distance to itself) and apply
        // the maximum distance
        (x, j) => j !== i && (maxDistance ? x < maxDistance : true)
      ).reduce<DistanceInfo[]>((acc, j) => {
        acc.push({
          $distance: consolidated[j],
          $metrics: summariseMetricResults(ports, metrics, results, j),
          ...(key ? { key: affluent[j][key] } : affluent[j]),
        });
        return acc;
      }, []);

      yield [`Calculated distances for ${i} items`, i / data.length];
    }

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
  return _.sortBy(values.map((v, i) => ({ i, v })), x => x.v)
    .filter(x => filter(x.v, x.i))
    .slice(0, limit)
    .map(x => x.i);
}
