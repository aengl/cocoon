import { scaleLinear } from 'd3-scale';
import _ from 'lodash';
import { Scorer } from '.';
import { interquartileRange } from '../statistics';

export interface IQRCache {
  scale: (x: number) => number;
}

export interface IQRConfig {
  /**
   * Multiplier for the IQR bounds. A value of 0 is equivalent to only taking
   * the midspread.
   *
   * For more information, see:
   * https://en.wikipedia.org/wiki/Interquartile_range
   *
   * Default is 1.5.
   */
  iqr?: number;

  /**
   * The score for values within the IQR.
   *
   * Default is 1.
   */
  reward?: number;

  /**
   * The score for values outside of the IQR.
   *
   * Default is 0.
   */
  penalty?: number;

  /**
   * The interpolation range, as a percentage of the total bounds.
   *
   * Domain for valid values: [0, .5[
   *
   * Default is .25.
   */
  smooth?: number | boolean;
}

/**
 * Uses the interquartile range to reward or penalise outliers.
 *
 * Values that fall outside of the IQR are assigned the score defined in
 * `penalty`, all other values are assigned the `reward`.
 */
export const IQR: Scorer<IQRConfig, IQRCache> = {
  cache(config, values, debug) {
    const filteredValues = values.filter(x => !_.isNil(x)) as number[];
    const reward = config.reward === undefined ? 1 : config.reward;
    const penalty = config.penalty === undefined ? 0 : config.penalty;
    const iqr = interquartileRange(
      config.iqr === undefined ? 1.5 : config.iqr,
      filteredValues
    );
    if (!config.smooth) {
      return {
        scale: x => (x < iqr[0] || x > iqr[1] ? penalty : reward),
      };
    }
    const smooth =
      config.smooth === true || config.smooth === undefined
        ? 0.25
        : !config.smooth
        ? 0
        : config.smooth;
    const smoothingDelta = (iqr[1] - iqr[0]) * smooth;
    const domain = [
      iqr[0] - smoothingDelta / 2,
      iqr[0] + smoothingDelta / 2,
      iqr[1] - smoothingDelta / 2,
      iqr[1] + smoothingDelta / 2,
    ];
    const range = [penalty, reward, reward, penalty];
    debug(`cached domain ${domain} and range ${range}`);
    return {
      scale: scaleLinear()
        .domain(domain)
        .range(range)
        .clamp(true),
    };
  },

  score(config, cache, value) {
    return _.isNil(value) ? null : cache.scale(value);
  },
};
