import { CocoonNode } from '@cocoon/types';
import {
  calculateScores,
  ConsolidatedMetricConfig,
  consolidateMetricResults,
  createMetricsFromDefinitions,
  prepareMetric,
  summariseMetricResults,
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
      required: true,
    },
  },

  out: {
    data: {},
  },

  async *process(context) {
    const ports = context.ports.read();
    const { attributes, data } = ports;

    Object.keys(attributes).forEach(attribute => {
      // For each scored attribute, create and cache its metrics
      const config = attributes[attribute];
      const metrics = createMetricsFromDefinitions(config.metrics);
      const metricsData = metrics.map(metric =>
        prepareMetric(metric, data, context.debug)
      );

      // Apply metrics
      const scores = metricsData.map(metric =>
        calculateScores(metric.instance, metric.cache, metric.values)
      );

      // Consolidate metric results
      const consolidated = consolidateMetricResults(config, scores);

      // Write consolidated score into the collection
      for (let i = 0; i < data.length; i++) {
        data[i] = {
          ...data[i],
          [attribute]: consolidated[i],
          [`\$${attribute}`]: summariseMetricResults(
            config,
            metrics,
            scores,
            i
          ),
        };
      }
    });

    context.ports.write({ data });
    return `Scored ${data.length} items`;
  },
};
