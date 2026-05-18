/** Verbatim port of legacy `@cocoon/plugin-distance/metrics/MAD.ts`.
 *  simple-statistics → `./numeric.ts`; lodash → `core/lodash-lite.ts`. */
import { isNil, isNumber, isNaN } from '../lodash-lite.ts';
import { median, medianAbsoluteDeviation } from './numeric.ts';
import type { DebugFunction, Metric } from './index.ts';
import { domain, interquartileRange } from './statistics.ts';

export interface Cache {
  debug: DebugFunction;
  domain?: (v: number) => number;
  median: number;
  medianAbsoluteDeviation: number;
}

export interface Config {
  /**
   * Clips outliers by calculating the midspread (IQR for .25 and .75
   * quantiles) and adding a multiple of the midspread range to its upper and
   * lower bound. A value of 0 is equivalent to only taking the midspread. If
   * set to true, a value of 1.5 is used (which is used in boxplots). Set to
   * `true` by default.
   */
  iqr?: number | boolean;
}

/**
 * A metric using the median absolute deviation.
 *
 * Values that are below the median score worse, values above the median score
 * better, with the magnitude of the score depending on the dispersion of the
 * value distribution.
 */
export const MAD: Metric<Config, Cache> = {
  cache(config, values, debug) {
    const filteredValues = values.filter(s => !isNil(s)) as number[];
    const cache = {
      debug,
      domain:
        config.iqr !== false
          ? domain(
              interquartileRange(
                isNumber(config.iqr) ? config.iqr : 1.5,
                filteredValues
              )
            )
          : undefined,
      median: median(filteredValues),
      medianAbsoluteDeviation: medianAbsoluteDeviation(filteredValues),
    };
    debug(
      `cached median of ${cache.median} and MAD of ${cache.medianAbsoluteDeviation}`
    );
    return cache;
  },

  score(config, cache, value) {
    if (isNil(value) || cache.medianAbsoluteDeviation === 0) {
      return null;
    }
    const delta = (cache.domain ? cache.domain(value) : value) - cache.median;
    const score = delta / cache.medianAbsoluteDeviation;
    if (isNaN(score)) {
      cache.debug(
        `produced a NaN for value: ${value} -- the cached MAD is: ${cache.medianAbsoluteDeviation}`
      );
      return null;
    }
    return score;
  },

  distance(config, cache, a, b) {
    throw new Error(`Not implemented`);
  },
};
