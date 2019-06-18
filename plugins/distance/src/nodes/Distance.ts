import { CocoonNode } from '@cocoon/types';
import * as distances from '../distance';
import _ from 'lodash';

export interface Ports {
  config: string | DistanceConfig;
  data: object[];
}

export interface DistanceConfig {
  /**
   * Name of the new attribute where the score is written to.
   */
  attribute?: string;

  /**
   * If true, the resulting consolidated scores are cast into a [0, 1] range.
   *
   * Some technical details about this process: individual scores of all scorers
   * for an item are first summed up. Then, the maximum and minimum of all these
   * consolidated scores is calculated, and they are subsequently mapped into a
   * [0, 1] range.
   *
   * This is in contrast to normalising the resulting score by the number of
   * scorers and has several implications:
   * - Items with few attributes usually fare worse, even without penalties
   * - If, however, a lot of scores are in the negative range, item with few
   *   attributes have an unfair advantage
   * - If *any* individual scorer produces large values, the entire consolidated
   *   score will be heavily shifted, which affects all items
   */
  normalise?: boolean;

  /**
   * If specified, limits the score's precision to a number of digits after the
   * comma.
   */
  precision?: number;

  /**
   * A list of scorers to use to score the collections.
   */
  distances: DistanceDefinition[];
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
    const { config } = ports;

    // Create distances
    const distanceConfig: DistanceConfig = await context.uri.resolveYaml(
      config,
      { root: context.definitions.root }
    );
    const distanceInstances = createDistanceFromDefinitions(
      distanceConfig.distances
    );

    // Evaluate scorers
    const prune = distanceConfig.precision
      ? x => (x === null ? x : _.round(x, distanceConfig.precision))
      : _.identity;

    const distanceResults = distanceInstances.map(distance => {
      context.debug(`running "${distance.type}" distance`, distance.config);
      return applyDistance(distance, data, prune, context.debug);
    });

    context.ports.write({
      distances: distanceResults,
    });

    return `Calculated distances for ${data.length} items`;
  },
};

function applyDistance(
  distances: DistanceInstance,
  data: object[],
  postprocess: (x: distances.DistanceResult) => distances.DistanceResult,
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
        postprocess(distances.instance.distance(config, cache, valueA, valueB))
      );
    }
    distanceArray.push(innerDistances);
  }

  return { distances: distanceArray, values };
}
