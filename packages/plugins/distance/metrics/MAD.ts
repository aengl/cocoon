import { DebugFunction } from '@cocoon/types';
import _ from 'lodash';
import { median, medianAbsoluteDeviation } from 'simple-statistics';
import { Metric } from '.';
import { domain, interquartileRange } from '../statistics';

export interface MADCache {
  debug: DebugFunction;
  domain?: (v: number) => number;
  median: number;
  medianAbsoluteDeviation: number;
}

export interface MADConfig {
  /**
   * Inverts the result, indicating that smaller values are better.
   */
  invert?: boolean;

  /**
   * Clips outliers by calculating the midspread (IQR for .25 and .75 quantiles)
   * and adding a multiple of the midspread range to its upper and lower bound.
   * The resulting range is used to restrict the input values for scoring.
   *
   * A value of 0 is equivalent to only taking the midspread. If this is set to
   * true, a value of 1.5 is used (which is used in boxplots).
   *
   * This is set to `true` by default.
   *
   * For more information, see:
   * https://en.wikipedia.org/wiki/Interquartile_range
   */
  iqr?: number | boolean;
}

/**
 * A metric using the median absolute deviation.
 *
 * Values that are below the median score worse, values above the median score
 * better, with the magnitude of the score depending on the dispersion of the
 * value distribution.
 *
 * MAD generally is a better choice over the standard deviation when dealing
 * with many outliers, and distributions that don't necessarily reflect normal
 * distributions.
 */
export const MAD: Metric<MADConfig, MADCache> = {
  cache(config, values, debug) {
    const filteredValues = values.filter(s => !_.isNil(s)) as number[];
    const cache = {
      debug,
      domain:
        config.iqr !== false
          ? domain(
              interquartileRange(
                _.isNumber(config.iqr) ? config.iqr : 1.5,
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
    if (_.isNil(value) || cache.medianAbsoluteDeviation === 0) {
      return null;
    }
    const delta = (cache.domain ? cache.domain(value) : value) - cache.median;
    const score =
      (delta / cache.medianAbsoluteDeviation) * (config.invert ? -1 : 1);
    if (_.isNaN(score)) {
      cache.debug(
        `produced a NaN for value: ${value} -- the cached MAD is: ${cache.medianAbsoluteDeviation}`
      );
      return null;
    }
    return score;
  },

  compare(config, cache, a, b) {
    throw new Error(`Not implemented`);
  },
};
