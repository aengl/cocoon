import { CocoonNode } from '@cocoon/types';
import _ from 'lodash';
import {
  applyCrossMetric,
  createMetricsFromDefinitions,
  CrossMetricConfig,
  MetricDefinitions,
  MetricResult,
} from '../metrics';

export interface Ports {
  attribute?: string;
  data: object[];
  key?: string;
  limit: number;
  metrics: MetricDefinitions<CrossMetricConfig>;
  precision?: number;
}

/**
 * An array in the form of: [distance, sourceIndex, targetIndex, matchResults]
 *
 * distance: The calculated distance between the two items.
 * sourceIndex: The data index of the item.
 * targetIndex: The target item index that the distance was calculated against.
 */
// type DistanceInfo = [number, number, number];

interface DistanceInfo {
  distance: number;
  key: string;
  results: {
    [name: string]: MetricResult;
  };
}

/**
 * Returns the n indices of the largest elements, in descending order.
 */
export function indexForTopN(
  values: MetricResult[],
  limit: number,
  exclude: number
) {
  return _.sortBy(values.map((v, i) => ({ i, v })), x => x.v)
    .filter(x => x.i !== exclude)
    .slice(0, limit)
    .map(x => x.i);
}

export const Distance: CocoonNode<Ports> = {
  category: 'Data',
  description: `Calculates a distance between all all items of a collection, based on custom distance `,

  in: {
    attribute: {
      description: `Name of the new attribute where the score is written to.`,
      hide: true,
    },
    data: {
      clone: true,
      required: true,
    },
    key: {
      description: `The primary key to reference items with the lowest distance in the results with.`,
      hide: true,
    },
    limit: {
      defaultValue: 10,
      description: `The distance node will only keep the n most similar items, which is determined by the limit configuration.`,
      hide: true,
    },
    metrics: {
      description: `A list of scorers to use to score the collections.`,
      hide: true,
      required: true,
    },
    precision: {
      description: `If specified, limits the score's precision to a number of digits after the comma.`,
      hide: true,
    },
  },

  out: {
    data: {},
    distances: {},
  },

  async *process(context) {
    const ports = context.ports.read();
    const { attribute, data, key, limit, precision } = ports;

    // Create and evaluate metrics
    const metrics = createMetricsFromDefinitions(ports.metrics);
    const distanceResults = metrics.map(metric =>
      applyCrossMetric(metric, data, context.debug)
    );

    // Get scorer weights
    const weights = metrics.map(i =>
      i.config.weight === undefined ? 1 : i.config.weight
    );
    const totalWeight = _.sum(weights);

    // Normalise weighted distances across all metrics
    const consolidatedDistances: number[][] = [];
    for (let i = 0; i < data.length; i++) {
      const distances: number[] = [];
      for (let j = 0; j < data.length; j++) {
        let distance = 0;
        for (let k = 0; k < distanceResults.length; k++) {
          const d = distanceResults[k].results[i][j];
          distance += (d || 0) * weights[k];
        }
        distances.push(distance / totalWeight);
      }
      context.progress(`Calculated distances for ${i} items`, i / data.length);
      consolidatedDistances.push(distances);
    }

    // Find the `n` most similar items
    const prune = precision
      ? x => (x === null ? x : _.round(x, precision))
      : _.identity;
    const dataKey = key || '_id';
    const distanceAttribute = attribute || 'related';
    for (let i = 0; i < data.length; i++) {
      data[i][distanceAttribute] = indexForTopN(
        consolidatedDistances[i],
        limit,
        i
      ).reduce<DistanceInfo[]>((acc, j) => {
        acc.push({
          distance: prune(consolidatedDistances[i][j]),
          key: data[j][dataKey],
          results: distanceResults.reduce(
            (acc2, results) => ({
              ...acc2,
              [results.instance.name]: prune(results.results[i][j]),
            }),
            {}
          ),
        });
        return acc;
      }, []);
    }

    context.ports.write({ data, distances: distanceResults });
    return `Calculated distances for ${data.length} items`;
  },
};
