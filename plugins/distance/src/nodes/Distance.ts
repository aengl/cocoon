import { CocoonNode } from '@cocoon/types';
import * as distances from '../distance';
import _ from 'lodash';
import { scaleLinear } from 'd3-scale';

export interface Ports {
  config: string | Config;
  data: object[];
}

export interface Config {
  /**
   * Name of the new attribute where the score is written to.
   */
  attribute?: string;

  /**
   * A list of scorers to use to score the collections.
   */
  distances: DistanceDefinition[];

  key?: string;

  /**
   * The distance node will only keep the `n` most similar items, which is
   * determined by the limit configuration.
   */
  limit: number;

  /**
   * If specified, limits the score's precision to a number of digits after the
   * comma.
   */
  // precision?: number;
}

/**
 * Represents a scorer definition.
 */
export interface DistanceDefinition<T extends DistanceConfig = DistanceConfig> {
  /**
   * Maps the module name to its configuration.
   */
  [moduleName: string]: T;
}

/**
 * The configuration for a Cocoon scorer.
 */
export interface DistanceConfig {
  /**
   * The name of the attribute that is scored.
   *
   * Scorers may define a different way of picking data via their `pick()`
   * function, in which case this configuration is ignored.
   */
  attribute?: string;

  /**
   * Default to a specified score when the value is missing. Can be used to
   * penalise items that don't have a value.
   *
   * The default value will still be subject to all other score manipulations,
   * as well as the weight.
   */
  default?: number;

  /**
   * A unique identifier for the distance metric, which will be embedded into
   * the results.
   */
  name: string;

  /**
   * Determines to what percentage the score will be factored into the
   * consolidation phase (when calculating the final score).
   */
  weight?: number;
}

interface DistanceInstance<ConfigType = DistanceConfig> {
  config: ConfigType;
  instance: distances.Distance<ConfigType>;
  type: string;
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
  index: number;
  key: string;
  results: {
    [name: string]: distances.DistanceResult;
  };
}

/**
 * Creates instances of all scorers in the definitions.
 */
export function createDistanceFromDefinitions(
  definitions: DistanceDefinition[]
): DistanceInstance[] {
  return definitions.map(definition => {
    const type = Object.keys(definition)[0];
    const config = definition[type];
    const instance = getDistance(type);
    return {
      config,
      instance,
      type,
    };
  });
}

/**
 * Looks up the corresponding distance by its type name.
 * @param type The distance type.
 */
export function getDistance<ConfigType = DistanceConfig, CacheType = null>(
  type: string
): distances.Distance<ConfigType, CacheType> {
  const distance = distances[type];
  if (!distance) {
    throw new Error(`distance metric type does not exist: ${type}`);
  }
  return distance;
}

/**
 * Returns the n indices of the largest elements, in descending order.
 */
export function indexForTopN(
  values: distances.DistanceResult[],
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
  description: `Calculates a distance between all all items of a collection, based on custom distance metrics.`,

  in: {
    config: {
      hide: true,
      required: true,
    },
    data: {
      required: true,
    },
  },

  out: {
    data: {},
    distances: {},
  },

  async process(context) {
    const ports = context.ports.read();
    const data = context.ports.copy(ports.data);

    // Create distances
    const config: Config = await context.uri.resolveYaml(ports.config, {
      root: context.definitions.root,
    });
    const distanceInstances = createDistanceFromDefinitions(config.distances);

    // Evaluate scorers
    const distanceResults = distanceInstances.map(distance => {
      context.debug(`applying "${distance.type}" distance`, distance.config);
      return applyDistance(distance, data, context.debug);
    });

    // const prune = config.precision
    // ? x => (x === null ? x : _.round(x, config.precision))
    // : _.identity;

    // Get scorer weights
    const weights = distanceInstances.map(i =>
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
          const d = distanceResults[k].distances[i][j];
          distance += (d || 0) * weights[k];
        }
        distances.push(distance / totalWeight);
      }
      consolidatedDistances.push(distances);
    }

    // Find the `n` most similar items
    const dataKey = config.key || '_id';
    const distanceAttribute = config.attribute || 'related';
    for (let i = 0; i < data.length; i++) {
      data[i][distanceAttribute] = indexForTopN(
        consolidatedDistances[i],
        config.limit,
        i
      ).reduce<DistanceInfo[]>((all, j) => {
        all.push({
          distance: consolidatedDistances[i][j],
          index: j,
          key: data[j][dataKey],
          results: {},
        });
        return all;
      }, []);
    }

    context.ports.write({ data });

    return `Calculated distances for ${data.length} items`;
  },
};

function applyDistance(
  distances: DistanceInstance,
  data: object[],
  debug: (...args: any[]) => void
) {
  if (!distances.instance.pick && !distances.config.attribute) {
    throw new Error(
      `attribute configuration missing for scorer "${distances.type}"`
    );
  }

  const config = distances.config;
  const values = distances.instance.pick
    ? data.map(item => distances.instance.pick!(config, item))
    : data.map(item => item[distances.config.attribute!]);

  // Create cache
  const cache = distances.instance.cache
    ? distances.instance.cache(config, values, debug)
    : null;

  // Collect distances
  const distanceArray: distances.DistanceResult[][] = [];
  for (let i = 0; i < values.length; i++) {
    const valueA = values[i];
    const innerDistances: distances.DistanceResult[] = [];
    for (let j = 0; j < values.length; j++) {
      const valueB = values[j];
      innerDistances.push(
        distances.instance.distance(config, cache, valueA, valueB)
      );
    }

    const norm = scaleLinear()
      .domain([min(innerDistances), max(innerDistances)])
      .range([0, 1]);
    distanceArray.push(
      innerDistances.map(distance =>
        _.isNil(distance) ? distance : norm(distance)
      )
    );
  }

  return { distances: distanceArray, values };
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
