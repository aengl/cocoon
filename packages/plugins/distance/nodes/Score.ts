import { CocoonNode } from '@cocoon/types';
import _ from 'lodash';
import {
  calculateScores,
  ConsolidatedMetricConfig,
  consolidateMetricResults,
  createMetricsFromDefinitions,
  prepareMetric,
  summariseMetricResults,
} from '../metrics';

export interface Ports extends ConsolidatedMetricConfig {
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
      required: true,
      visible: false,
    },
    data: {
      required: true,
    },
    metrics: {
      description: `Configures the distance metrics.`,
      visible: false,
    },
    normalise: {
      description: `If true, the resulting consolidated scores are cast into a [0, 1 range.`,
      visible: false,
    },
    precision: {
      description: `If specified, limits the score precision to a number of digits after the comma.`,
      visible: false,
    },
  },

  out: {
    data: {},
    scores: {},
  },

  async *process(context) {
    const ports = context.ports.read();
    const { attributes, data } = ports;
    const scores = new Array(data.length);

    Object.keys(attributes).forEach(attribute => {
      // For each scored attribute, create and cache its metrics
      const config = attributes[attribute];
      const metrics = createMetricsFromDefinitions(config.metrics);
      const metricsData = metrics.map(metric =>
        prepareMetric(metric, data, context.debug)
      );

      // Apply metrics
      const results = metricsData.map(metric =>
        calculateScores(metric.instance, metric.cache, metric.values)
      );

      // Consolidate metric results
      const consolidated = consolidateMetricResults(config, results);

      // Write consolidated score into the collection
      for (let i = 0; i < data.length; i++) {
        const summarised = summariseMetricResults(config, metrics, results, i);
        data[i] = {
          ...data[i],
          [attribute]: consolidated[i],
          [`\$${attribute}`]: summarised,
        };
        scores[i] = {
          ...scores[i],
          [attribute]: consolidated[i],
          ..._.mapKeys(summarised, (value, key) => `${attribute}_${key}`),
        };
      }
    });

    context.ports.write({ data, scores });
    return `Scored ${data.length} items`;
  },
};
