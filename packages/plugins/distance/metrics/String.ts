import _ from 'lodash';
import { Metric, MetricResult } from '.';
import { compareTwoStrings } from 'string-similarity';

export interface Config {
  /**
   * When scoring, calculate the distance to this value.
   */
  value?: string;

  /**
   * If true, the first character must be identical.
   *
   * This speeds up the matching significantly and handles many real-world
   * use-cases better ("7 Wonders" vs "Wonders").
   */
  firstCharacterMustMatch?: boolean;

  /**
   * If true, compare lowercase variants of both strings.
   */
  ignoreCase: boolean;
}

/**
 * Calculates the similarity between two strings (0 to 1).
 */
// tslint:disable-next-line:variable-name
export const String: Metric<Config, null, string> = {
  score(config, cache, v) {
    if (!config.value) {
      throw new Error(`reference value not set`);
    }
    return compare(config, v, config.value);
  },

  distance(config, cache, a, b) {
    return compare(config, a, b);
  },
};

function compare(config: Config, a: string, b: string): MetricResult {
  if (config.firstCharacterMustMatch && a[0] !== b[0]) {
    return null;
  }
  if (config.ignoreCase) {
    return 1.0 - compareTwoStrings(a.toLowerCase(), b.toLowerCase());
  }
  return 1.0 - compareTwoStrings(a, b);
}
