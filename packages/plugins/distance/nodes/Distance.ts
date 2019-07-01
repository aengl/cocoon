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
  config: Config;
  data: object[];
}

export interface Config {
  /**
   * Name of the new attribute where the score is written to.
   */
  attribute?: string;

  /**
   * The primary key to reference items with the lowest distance in the results
   * with.
   */
  key?: string;

  /**
   * The distance node will only keep the `n` most similar items, which is
   * determined by the limit configuration.
   */
  limit: number;

  /**
   * A list of scorers to use to score the collections.
   */
  metrics: MetricDefinitions<CrossMetricConfig>;

  /**
   * If specified, limits the score's precision to a number of digits after the
   * comma.
   */
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
    config: {
      hide: true,
      required: true,
    },
    data: {
      clone: true,
      required: true,
    },
  },

  out: {
    data: {},
    distances: {},
  },

  async process(context) {
    const { config, data } = context.ports.read();

    // Create distances
    const metrics = createMetricsFromDefinitions(config.metrics);

    // Evaluate scorers
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
    const prune = config.precision
      ? x => (x === null ? x : _.round(x, config.precision))
      : _.identity;
    const dataKey = config.key || '_id';
    const distanceAttribute = config.attribute || 'related';
    for (let i = 0; i < data.length; i++) {
      data[i][distanceAttribute] = indexForTopN(
        consolidatedDistances[i],
        config.limit,
        i
      ).reduce<DistanceInfo[]>((all, j) => {
        all.push({
          distance: prune(consolidatedDistances[i][j]),
          key: data[j][dataKey],
          results: distanceResults.reduce(
            (all, results) => ({
              ...all,
              [results.instance.name]: prune(results.results[i][j]),
            }),
            {}
          ),
        });
        return all;
      }, []);
    }

    context.ports.write({ data, distances: distanceResults });
    return `Calculated distances for ${data.length} items`;
  },
};
