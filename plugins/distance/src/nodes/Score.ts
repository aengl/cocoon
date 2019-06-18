import { CocoonNode } from '@cocoon/types';
import { scaleLinear } from 'd3-scale';
import _ from 'lodash';
import {
  mean,
  median,
  medianAbsoluteDeviation,
  standardDeviation,
} from 'simple-statistics';
import * as scorers from '../scorers';

export interface Ports {
  config: string | ScoreConfig;
  data: object[];
}

export interface ScoreConfig {
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
  scorers: ScorerDefinition[];
}

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
   * Defines the range of valid scores. Scores that fall outside of this domain
   * will be clamped.
   *
   * See: https://github.com/d3/d3-scale#continuous_domain
   */
  domain?: [number, number];

  /**
   * Defines the range that the scores will be mapped into.
   *
   * See: https://github.com/d3/d3-scale#continuous_range
   */
  range?: [number, number];

  /**
   * Determines to what percentage the score will be factored into the
   * consolidation phase (when calculating the final score).
   */
  weight?: number;
}

interface ScorerInstance<ConfigType = ScorerConfig> {
  config: ConfigType;
  instance: scorers.Scorer<ConfigType>;
  type: string;
}

/**
 * Creates instances of all scorers in the definitions.
 */
export function createScorersFromDefinitions(
  definitions: ScorerDefinition[]
): ScorerInstance[] {
  return definitions.map(definition => {
    const type = Object.keys(definition)[0];
    const config = definition[type];
    const instance = getScorer(type);
    return {
      config,
      instance,
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
): scorers.Scorer<ConfigType, CacheType> {
  const scorer = scorers[type];
  if (!scorer) {
    throw new Error(`scorer type does not exist: ${type}`);
  }
  return scorer;
}

export const Score: CocoonNode<Ports> = {
  category: 'Data',
  description: `Scores items in a data collection`,

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
    stats: {},
  },

  async process(context) {
    const ports = context.ports.read();
    const data = context.ports.copy(ports.data);
    const { config } = ports;

    // Create scorers
    const scoreConfig: ScoreConfig = await context.uri.resolveYaml(config, {
      root: context.definitions.root,
    });
    const scorerInstances = createScorersFromDefinitions(scoreConfig.scorers);

    // Evaluate scorers
    const scorerResults = scorerInstances.map(scorer => {
      context.debug(`running "${scorer.type}" scorer`, scorer.config);
      return applyScorer(scorer, data, context.debug);
    });

    // Consolidate the individual scoring results into a single score
    let consolidatedScores = data.map((_0, index) => {
      const itemScores = scorerResults.map(res => res.scores[index]);
      const sum = _.sum(itemScores) || 0;
      return sum;
    });

    // Normalise the scores
    if (scoreConfig.normalise) {
      const norm = scaleLinear()
        .domain([min(consolidatedScores), max(consolidatedScores)])
        .range([0, 1]);
      consolidatedScores = consolidatedScores.map(score => norm(score));
    }

    if (scoreConfig.precision) {
      consolidatedScores = consolidatedScores.map(score =>
        _.round(score, scoreConfig.precision)
      );
    }

    // Write consolidated score into the collection
    const scoreAttribute = scoreConfig.attribute || 'score';
    data.forEach((item, index) => {
      item[scoreAttribute] = consolidatedScores[index];
    });
    context.ports.write({
      data,
      stats: {
        consolidated: analyseScores(consolidatedScores),
        scorers: scorerInstances.map((scorer, i) => ({
          ...scorer.config,
          ...analyseScores(scorerResults[i].scores, scorerResults[i].values),
        })),
      },
    });
    return `Scored ${data.length} items`;
  },
};

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

function applyScorer(
  scorer: ScorerInstance,
  data: object[],
  debug: (...args: any[]) => void
) {
  if (!scorer.instance.pick && !scorer.config.attribute) {
    throw new Error(
      `attribute configuration missing for scorer "${scorer.type}"`
    );
  }

  const config = scorer.config;
  const values = scorer.instance.pick
    ? data.map(item => scorer.instance.pick!(config, item))
    : data.map(item => item[scorer.config.attribute!]);

  // Create cache
  const cache = scorer.instance.cache
    ? scorer.instance.cache(config, values, debug)
    : null;

  // Collect scores
  let scores = values.map(v =>
    v === undefined ? null : scorer.instance.score(config, cache, v)
  );

  // Apply score manipulation functions
  if (config.default !== undefined) {
    scores = scores.map(s => (_.isNil(s) ? config.default! : s));
  }
  if (config.domain !== undefined || config.range !== undefined) {
    const scale = scaleLinear()
      .domain(config.domain || [min(scores), max(scores)])
      .range(config.range || config.domain!)
      .clamp(true);
    scores = scores.map(s => (_.isNil(s) ? s : scale(s)));
  }
  if (config.weight !== undefined) {
    scores = scores.map(s => (_.isNil(s) ? s : s * config.weight!));
  }
  return { scores, values };
}

/**
 * Calculates various statistic metrics for analysing a score distribution.
 * @param scores The score distribution to analyse.
 * @param values The values that were scored.
 */
function analyseScores(scores: scorers.ScorerResult[], values?: any[]) {
  const filterIndices = scores.map(s => s !== null);
  const filteredScores = scores.filter(
    (_0, i) => filterIndices[i] === true
  ) as number[];
  const filteredValues = values
    ? values.filter((_0, i) => filterIndices[i] === true)
    : undefined;
  if (filteredScores.length === 0) {
    // Can't create meaningful stats if there's no actual scores
    return { scores: [] as number[] };
  }
  return {
    scores: filteredScores,
    values: filteredValues,
    stats: {
      min: _.round(min(filteredScores), 2),
      // tslint:disable-next-line
      max: _.round(max(filteredScores), 2),
      mean: _.round(mean(filteredScores), 2),
      median: _.round(median(filteredScores), 2),
      mad: _.round(medianAbsoluteDeviation(filteredScores), 2),
      stdev: _.round(standardDeviation(filteredScores), 2),
      count: {
        ..._.countBy(filteredScores, s => (!s ? '0' : s > 0 ? '+' : '-')),
        null: scores.length - filteredScores.length,
      },
    },
  };
}
