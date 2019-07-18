import { CocoonNode } from '@cocoon/types';
import {
  calculateMetricResult,
  ConsolidatedMetricConfig,
  consolidateMetricResults,
  createMetricsFromDefinitions,
  prepareMetric,
} from '../metrics';

export interface Ports {
  attributes: {
    [attribute: string]: ConsolidatedMetricConfig;
  };
  data: object[];
}

export const Score: CocoonNode<Ports> = {
  category: 'Data',
  description: `Scores items in a data collection`,

  in: {
    attributes: {
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

  async *process(context) {
    const ports = context.ports.read();
    const { attributes, data } = ports;

    const results = Object.keys(attributes).map(attribute => {
      // For each scored attribute, create and cache its metrics
      const config = attributes[attribute];
      const metrics = createMetricsFromDefinitions(config.metrics).map(metric =>
        prepareMetric(metric, data, context.debug)
      );

      // Apply metrics
      const metricResults = metrics.map(metric =>
        calculateMetricResult(metric.instance, metric.cache, metric.values)
      );

      // Consolidate metric results
      const consolidated = consolidateMetricResults(config, metricResults);

      // Write consolidated score into the collection
      for (let i = 0; i < data.length; i++) {
        data[i][attribute] = consolidated[i];
      }

      return { attribute, consolidated, metricResults, metrics };
    });

    context.ports.write({
      data,
      // stats: results.reduce((acc, x) => {
      //   acc[x.attribute] = {
      //     consolidated: analyseScores(x.consolidated),
      //     scorers: x.metrics.map(metric => ({
      //       ...metric.instance,
      //       ...analyseScores(x.metricResults, metric.values),
      //     })),
      //   };
      //   return acc;
      // }, {}),
    });
    return `Scored ${data.length} items`;
  },
};

/**
 * Calculates various statistic metrics for analysing a score distribution.
 * @param scores The score distribution to analyse.
 * @param values The values that were scored.
 */
// function analyseScores(scores: MetricResult[], values?: any[]) {
//   const filterIndices = scores.map(s => s !== null);
//   const filteredScores = scores.filter(
//     (_0, i) => filterIndices[i] === true
//   ) as number[];
//   const filteredValues = values
//     ? values.filter((_0, i) => filterIndices[i] === true)
//     : undefined;
//   if (filteredScores.length === 0) {
//     // Can't create meaningful stats if there's no actual scores
//     return { scores: [] as number[] };
//   }
//   return {
//     scores: filteredScores,
//     stats: {
//       min: _.round(min(filteredScores), 2),
//       // tslint:disable-next-line
//       max: _.round(max(filteredScores), 2),
//       mean: _.round(mean(filteredScores), 2),
//       median: _.round(median(filteredScores), 2),
//       mad: _.round(medianAbsoluteDeviation(filteredScores), 2),
//       stdev: _.round(standardDeviation(filteredScores), 2),
//       count: {
//         ..._.countBy(filteredScores, s => (!s ? '0' : s > 0 ? '+' : '-')),
//         null: scores.length - filteredScores.length,
//       },
//     },
//     values: filteredValues,
//   };
// }
