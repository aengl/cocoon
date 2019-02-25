import { histogram } from 'd3-array';
import { scaleLinear } from 'd3-scale';
import _ from 'lodash';
import {
  mean,
  median,
  medianAbsoluteDeviation,
  standardDeviation,
} from 'simple-statistics';
import sparkly from 'sparkly';
import { NodeObject } from '../../../common/node';
import {
  createScorersFromDefinitions,
  Scorer,
  ScorerDefinition,
  ScorerResult,
} from '../../scorers';

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
   * A list of scorers to use to score the collections.
   */
  scorers: ScorerDefinition[];
}

/**
 * Scores all values in a collection.
 */
export const Score: NodeObject = {
  category: 'Data',

  in: {
    config: {
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
    const data = context.ports.copy<object[]>('data');
    const config = context.ports.read<ScoreConfig>('config');
    const scoreAttribute = config.attribute || 'score';

    // Create scorers
    const scorerInstances = createScorersFromDefinitions(config.scorers);

    // Evaluate scorers
    const scorerResults = scorerInstances.map(scorer => {
      context.debug(`scoring "${scorer.config.attribute}"`);
      return applyScorer(scorer, data);
    });

    // Consolidate the individual scoring results into a single score
    let consolidatedScores = data.map((_0, index) => {
      const itemScores = scorerResults.map(res => res.scores[index]);
      const sum = _.sum(itemScores) || 0;
      return sum;
    });

    // Normalise the scores
    if (config.normalise) {
      const norm = scaleLinear()
        .domain([min(consolidatedScores), max(consolidatedScores)])
        .range([0, 1]);
      consolidatedScores = consolidatedScores.map(score => norm(score));
    }

    // Write consolidated score into the collection
    data.forEach((item, index) => {
      item[scoreAttribute] = consolidatedScores[index];
    });
    context.ports.writeAll({
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

/**
 * Scores each data item and returns the array of all scores.
 * @param definition The scorer definition.
 * @param data The data to score.
 */
function applyScorer(scorer: Scorer, data: object[]) {
  const config = scorer.config;
  const attribute = scorer.config.attribute;
  const values = _.isArray(attribute)
    ? data.map(item => attribute.map(a => item[a]))
    : data.map(item => item[attribute]);

  // Create cache
  const cache =
    scorer.object.cache !== undefined
      ? scorer.object.cache(config, values)
      : null;

  // Collect scores
  let scores = values.map(v =>
    v === undefined ? null : scorer.object.score(config, cache, v)
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
 */
function analyseScores(scores: ScorerResult[], values?: any[]) {
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
    // tslint:disable-next-line
    spark: sparkly(histogram()(filteredScores).map(bin => bin.length)),
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
