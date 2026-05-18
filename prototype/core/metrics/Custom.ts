/** Verbatim port of legacy `@cocoon/plugin-distance/metrics/Custom.ts`.
 *  `@cocoon/util/castFunction` → the vendored `core/cast-function.ts`. */
import { castFunction } from '../cast-function.ts';
import type { Metric, MetricResult } from './index.ts';

export type PickFunction = (x: any) => MetricResult;
export type ScoreFunction = (x: any) => MetricResult;
export type CompareFunction = (a: any, b: any) => MetricResult;

export interface Config {
  pick?: string | PickFunction;
  score?: string | ScoreFunction;
  compare?: string | CompareFunction;
}

export interface Cache {
  score: (x: any) => MetricResult;
  compare: (a: any, b: any) => MetricResult;
}

/**
 * Custom-defined metric functions for scoring and comparing.
 */
export const Custom: Metric<Config, Cache, any> = {
  pick(config, item, attribute, affluent) {
    return item;
  },

  cache(config, values, debug) {
    return {
      compare: config.compare
        ? castFunction<CompareFunction>(config.compare)!
        : x => x,
      score: config.score ? castFunction<ScoreFunction>(config.score)! : x => x,
    };
  },

  score(config, cache, v) {
    return cache.score(v);
  },

  distance(config, cache, a, b) {
    return cache.compare(a, b);
  },
};
