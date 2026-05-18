import {
  calculateScores,
  consolidateMetricResults,
  createMetricsFromDefinitions,
  prepareMetric,
  summariseMetricResults,
} from '../metrics/index.ts';
import { mapKeys } from '../lodash-lite.ts';
import type { CocoonProcessNode } from '../contract.ts';

/**
 * Verbatim port of legacy `@cocoon/plugin-distance` nodes/Score — the whole
 * metric machinery ported with it (`core/metrics/*`), lodash/d3/ss/
 * string-similarity shed to faithful zero-dep slices
 * (`lodash-lite.ts`/`metrics/numeric.ts`) pinned to the legacy dep versions.
 *
 * **Parity-locked / snapshot-locked** like `Sort`: scoring decides ranking
 * order, which is the entire point of the Tibi flows, so the port is
 * bit-for-bit and guarded by `score-node.test.ts` (the exact legacy
 * `Score.test.ts.md` AVA snapshots + the legacy per-metric unit tests for the
 * metrics `boardgames.yml` uses — MAD/Linear/Test/Equal/IQR/Rank). The
 * "code is the flow" pivot must NOT touch this node's behaviour.
 *
 * Registry-free: legacy `in`/`out` schema dropped (ports are
 * YAML-structure-derived); `attributes` arrives as a literal `in:` config
 * object, `data` over an edge — both via `context.ports.read()`.
 */
export const Score: CocoonProcessNode = {
  category: 'Data',
  description: `Scores items in a data collection`,

  async *process(context) {
    const ports = context.ports.read() as {
      attributes: { [attribute: string]: any };
      data: object[];
    };
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
          ...mapKeys(summarised, (value, key) => `${attribute}_${key}`),
        };
      }
    });

    context.ports.write({ data, scores });
    return `Scored ${data.length} items`;
  },
};
