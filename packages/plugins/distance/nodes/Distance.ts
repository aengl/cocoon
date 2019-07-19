import { CocoonNode } from '@cocoon/types';
import _ from 'lodash';
import {
  calculateDistances,
  ConsolidatedMetricConfig,
  createMetricsFromDefinitions,
  DistanceConfig,
  MetricResult,
  prepareDistanceMetric,
  consolidateMetricResults,
} from '../metrics';

export interface Ports extends ConsolidatedMetricConfig<DistanceConfig> {
  attribute?: string;
  data: object[];
  distance?: number;
  key?: string;
  limit: number;
  affluent?: object[];
}

interface DistanceInfo {
  distance: number;
  item?: object;
  key?: string;
  results: {
    [name: string]: MetricResult;
  };
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
      description: `Name of the new attribute where the score is written to.`,
      hide: true,
    },
    data: {
      clone: true,
      description: `The data for which to calculate distances.`,
      required: true,
    },
    distance: {
      description: `The maximum allowed distance.`,
      hide: true,
    },
    key: {
      description: `The primary key to reference items with the lowest distance in the results with. If left undefined, the entire item will be added to the data.`,
      hide: true,
    },
    limit: {
      defaultValue: 10,
      description: `The distance node will only keep the n most similar items, which is determined by the limit configuration.`,
      hide: true,
    },
    metrics: {
      description: `A sequence of metrics used to calculate the distance.`,
      hide: true,
      required: true,
    },
    precision: {
      description: `If specified, limits the distance's precision to a number of digits after the comma.`,
      hide: true,
    },
  },

  out: {
    data: {},
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
      precision,
    } = ports;
    const affluent = ports.affluent || data;

    // Create and cache metrics
    const metrics = createMetricsFromDefinitions(metricDefinitions).map(
      metric => prepareDistanceMetric(metric, data, affluent, context.debug)
    );

    // Calculate distances
    for (let i = 0; i < data.length; i++) {
      // Calculate distances for current item
      const distances = metrics.map(metric =>
        calculateDistances(
          metric.instance,
          metric.cache,
          metric.values[i],
          metric.affluentValues
        )
      );

      // Consolidate metric results
      const consolidated = consolidateMetricResults(ports, distances);

      // Find the `n` most similar items
      const prune = precision
        ? x => (x === null ? x : _.round(x, precision))
        : _.identity;
      const distanceAttribute = attribute || 'related';
      data[i][distanceAttribute] = indexForTopN(
        consolidated,
        limit,
        // Filter the current item (don't consider distance to itself) and apply
        // the maximum distance
        (x, j) => j !== i && (maxDistance ? x < maxDistance : true)
      ).reduce<DistanceInfo[]>((acc, j) => {
        acc.push({
          distance: prune(consolidated[j]),
          key: key ? affluent[j][key] : undefined,
          results: distances.reduce(
            (acc2, results, k) => ({
              ...acc2,
              [metrics[k].instance.name]: prune(results[j]),
            }),
            {}
          ),
          ...(key ? undefined : affluent[j]),
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
