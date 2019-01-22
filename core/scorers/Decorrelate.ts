import _ from 'lodash';
import { linearRegression, linearRegressionLine } from 'simple-statistics';
import { ScorerConfig, ScorerObject } from '.';

export interface DecorrelateCache {
  decorrelate: (x: [number, number]) => number;
}

export interface DecorrelateConfig extends ScorerConfig {}

/**
 * Decorrelates two dimensions by flattening the regression.
 *
 * The result value corresponds to the first attribute, but adjusted for the
 * bias introduced via the second attribute.
 */
export const Decorrelate: ScorerObject<DecorrelateConfig, DecorrelateCache> = {
  cache(config, values) {
    if (!_.isArray(config.attribute) || config.attribute.length !== 2) {
      throw new Error(`Decorrelate needs exactly two attributes`);
    }
    const regressionResult = linearRegression(values);
    const regressionLine = linearRegressionLine(regressionResult);
    return {
      decorrelate: v => v[0] - regressionLine(v[1]) / 2,
    };
  },

  score(config, cache, value) {
    return cache.decorrelate(value);
  },
};
