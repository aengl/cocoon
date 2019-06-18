import _ from 'lodash';
import { linearRegression, linearRegressionLine } from 'simple-statistics';
import { Scorer, NumberOrNil } from '.';

export interface DecorrelateCache {
  decorrelate: (x: [number, number]) => number;
}

export interface DecorrelateConfig {
  attributes: string[];
}

/**
 * Decorrelates two dimensions by flattening the regression.
 *
 * The result value corresponds to the first attribute, but adjusted for the
 * bias introduced via the second attribute.
 */
export const Decorrelate: Scorer<
  DecorrelateConfig,
  DecorrelateCache,
  [NumberOrNil, NumberOrNil]
> = {
  pick(config, item) {
    return [item[config.attributes[0]], item[config.attributes[1]]];
  },

  cache(config, values) {
    const filteredValues = values.filter(
      x => !_.isNil(x[0]) && !_.isNil(x[1])
    ) as [number, number][];
    const regressionResult = linearRegression(filteredValues);
    const regressionLine = linearRegressionLine(regressionResult);
    return {
      decorrelate: v => v[0] - regressionLine(v[1]) / 2,
    };
  },

  score(config, cache, value) {
    return _.isNil(value) || _.isNil(value[0]) || _.isNil(value[1])
      ? null
      : cache.decorrelate(value as [number, number]);
  },
};
