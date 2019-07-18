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
  distance?: number;
  key?: string;
  limit: number;
  metrics: MetricDefinitions<CrossMetricConfig>;
  precision?: number;
  target?: object[];
}

interface DistanceInfo {
  distance: number;
  item?: object;
  key?: string;
  results: {
    [name: string]: MetricResult;
  };
}

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

export const Distance: CocoonNode<Ports> = {
  category: 'Data',
  description: `Calculates a distance between all items of one or two collections, based on custom distance.`,

  in: {
    attribute: {
      description: `Name of the new attribute where the score is written to.`,
      hide: true,
    },
    data: {
      clone: true,
      required: true,
    },
    distance: {
      description: `The maximum allowed distance.`,
      hide: true,
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
    target: {
      description:
        'If supplied, calculate distances between the data and this target data set.',
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
      precision,
    } = ports;
    const target = ports.target || data;

    // Create and evaluate metrics
    const metrics = createMetricsFromDefinitions(ports.metrics);
    const distanceResults = metrics.map(
      metric =>
        [...applyCrossMetric(metric, data, target, context.debug)].slice(-1)[0]
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
      for (let j = 0; j < target.length; j++) {
        let distance = 0;
        for (let k = 0; k < distanceResults.length; k++) {
          const d = distanceResults[k].results[i][j];
          distance += (d || 0) * weights[k];
        }
        distances.push(distance / totalWeight);
      }
      consolidatedDistances.push(distances);
      yield `Calculated distances for ${i} items`;
    }

    // Find the `n` most similar items
    const prune = precision
      ? x => (x === null ? x : _.round(x, precision))
      : _.identity;
    const distanceAttribute = attribute || 'related';
    for (let i = 0; i < data.length; i++) {
      data[i][distanceAttribute] = indexForTopN(
        consolidatedDistances[i],
        limit,
        // Filter the current item (don't consider distance to itself) and apply
        // the maximum distance
        (x, j) => j !== i && (maxDistance ? x < maxDistance : true)
      ).reduce<DistanceInfo[]>((acc, j) => {
        acc.push({
          distance: prune(consolidatedDistances[i][j]),
          item: key ? undefined : target[j],
          key: key ? target[j][key] : undefined,
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
