import _ from 'lodash';

const scorers = _.merge(
  {},
  require('./Identity'),
  require('./IQR'),
  require('./MAD'),
  require('./Rank'),
  require('./Test')
);

export type ScorerResult = number | null;

/**
 * Represents a scorer definition.
 */
export interface ScorerDefinition<T extends ScorerConfig = ScorerConfig> {
  /**
   * Maps the module name to its configuration.
   */
  [moduleName: string]: T;
}

/**
 * The configuration for a Cocoon scorer.
 */
export interface ScorerConfig {
  /**
   * The name of the attribute that is scored.
   */
  attribute: string;

  /**
   * Default to a specified score when the value is missing. Can be used to
   * penalise items that don't have a value.
   *
   * The default value will still be subject to all other score manipulations,
   * as well as the weight.
   */
  default?: number;

  /**
   * Defines the range of valid scores. Scores that fall outside of this domain
   * will be clamped.
   *
   * See: https://github.com/d3/d3-scale#continuous_domain
   */
  domain?: [number, number];

  /**
   * Defines the range that the scores will be mapped into.
   * d
   * See: https://github.com/d3/d3-scale#continuous_range
   */
  range?: [number, number];

  /**
   * Determines to what percentage the score will be factored into the
   * consolidation phase (when calculating the final score).
   */
  weight?: number;
}

/**
 * Common interface for all scorers.
 *
 * A scorer compares a single value to all other values of that attribute and
 * produces a single, qualitative value.
 */
export interface ScorerObject<ConfigType = ScorerConfig, CacheType = null> {
  /**
   * Creates a shared cache that is passed to each invocation of `score()`.
   *
   * If omitted, no cache is created.
   */
  cache?(config: ConfigType, values: any[]): CacheType;

  /**
   * Scores a value by comparing it to all other values in that attribute.
   */
  score(config: ConfigType, cache: CacheType, value: any): ScorerResult;
}

/**
 * A scorer instance.
 */
export interface Scorer<ConfigType = ScorerConfig> {
  config: ConfigType;
  object: ScorerObject<ConfigType>;
  type: string;
}

/**
 * Creates instances of all scorers in the definitions.
 */
export function createScorersFromDefinitions(
  definitions: ScorerDefinition[]
): Scorer[] {
  return definitions.map(definition => {
    const type = Object.keys(definition)[0];
    const config = definition[type];
    const object = getScorer(type);
    return {
      config,
      object,
      type,
    };
  });
}

/**
 * Looks up the corresponding scorer by its type name.
 * @param type The scorer type.
 */
export function getScorer<ConfigType = ScorerConfig, CacheType = null>(
  type: string
): ScorerObject<ConfigType, CacheType> {
  const scorer = scorers[type];
  if (!scorer) {
    throw new Error(`scorer type does not exist: ${type}`);
  }
  return scorer;
}
