import { CocoonNode } from '@cocoon/types';
import { scaleLinear } from 'd3-scale';
import _ from 'lodash';
import {
  mean,
  median,
  medianAbsoluteDeviation,
  standardDeviation,
} from 'simple-statistics';
import {
  createMetricsFromDefinitions,
  MetricConfig,
  MetricDefinitions,
  MetricInstance,
  MetricResult,
} from '../metrics';
import { MissingOne } from '../missing';

type ScorerConfig = MetricConfig & MissingOne;

export interface Ports {
  config: string | Config;
  data: object[];
}

export interface Config {
  [attribute: string]: AttributeConfig;
}

export interface AttributeConfig {
  /**
   * A list of scorers to use to score the collections.
   */
  metrics: MetricDefinitions<MissingOne>;

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
      clone: true,
      required: true,
    },
  },

  out: {
    data: {},
    stats: {},
  },

  async process(context) {
    const ports = context.ports.read();
    const { data } = ports;

    // Create scorers
    const config: Config = await context.uri.resolveYaml(ports.config, {
      root: context.definitions.root,
    });
    const results = Object.keys(config).map(targetAttribute => ({
      attribute: targetAttribute,
      config: config[targetAttribute],
      ...score(config[targetAttribute], data, context.debug),
    }));

    // Write consolidated score into the collection
    results.forEach(result => {
      data.forEach((item, index) => {
        item[result.attribute] = result.consolidated[index];
      });
    });

    // Write consolidated score into the collection
    context.ports.write({
      data,
      stats: results.reduce((all, res) => {
        all[res.attribute] = {
          consolidated: analyseScores(res.consolidated),
          scorers: res.scorers.map(x => ({
            ...x.config,
            ...analyseScores(x.scores, x.values),
          })),
        };
        return all;
      }, {}),
    });
    return `Scored ${data.length} items`;
  },
};

export function score(
  config: AttributeConfig,
  data: object[],
  debug: (...args: any[]) => void
) {
  const metrics = createMetricsFromDefinitions(config.metrics);

  // Evaluate scorers
  const scorers = metrics
    .map(metric => {
      debug(`applying "${metric.name}"`, metric.config);
      return applyScorer(metric, data, debug);
    })
    .filter(_.isNil);

  // Consolidate the individual scoring results into a single score
  let consolidated = data.map((_0, index) => {
    const itemScores = scorers.map(res => res.scores[index]);
    const sum = _.sum(itemScores) || 0;
    return sum;
  });

  // Normalise the scores
  if (config.normalise) {
    const norm = scaleLinear()
      .domain([min(consolidated), max(consolidated)])
      .range([0, 1]);
    consolidated = consolidated.map(score => norm(score));
  }

  if (config.precision) {
    consolidated = consolidated.map(score => _.round(score, config.precision));
  }

  return { consolidated, scorers };
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

function applyScorer(
  instance: MetricInstance<ScorerConfig>,
  data: object[],
  debug: (...args: any[]) => void
) {
  const config = instance.config;
  const values = instance.obj.pick
    ? data.map(item => instance.obj.pick!(config, item))
    : data.map(item => item[instance.config.attribute || instance.name]);

  // Create cache
  const cache = instance.obj.cache
    ? instance.obj.cache(config, values, debug)
    : null;

  // Collect scores
  const ifMissing = config.ifMissing === undefined ? null : config.ifMissing;
  let scores = values.map(v =>
    _.isNil(v) ? ifMissing : instance.obj.score(config, cache, v)
  );

  // Apply score manipulation functions
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
  return { config, scores, values };
}

/**
 * Calculates various statistic metrics for analysing a score distribution.
 * @param scores The score distribution to analyse.
 * @param values The values that were scored.
 */
function analyseScores(scores: MetricResult[], values?: any[]) {
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
