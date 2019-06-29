import _ from 'lodash';
import { linearRegression, linearRegressionLine } from 'simple-statistics';
import { Metric } from '.';

export interface DecorrelateCache {
  decorrelate: (x: [number, number]) => number;
}

export interface DecorrelateConfig {
  attributes: string[];
}

type NumberOrNil = number | null | undefined;

/**
 * Decorrelates two dimensions by flattening the regression.
 *
 * The result value corresponds to the first attribute, but adjusted for the
 * bias introduced via the second attribute.
 */
export const Decorrelate: Metric<
  DecorrelateConfig,
  DecorrelateCache,
  [NumberOrNil, NumberOrNil]
> = {
  pick(config, item) {
    return [item[config.attributes[0]], item[config.attributes[1]]];
  },

  cache(config, values) {
    const filteredValues = values.filter(
      x => !_.isNil(x) && !_.isNil(x[0]) && !_.isNil(x[1])
    ) as [number, number][];
    const regressionResult = linearRegression(filteredValues);
    const regressionLine = linearRegressionLine(regressionResult);
    return {
      decorrelate: v => v[0] - regressionLine(v[1]) / 2,
    };
  },

  score(config, cache, v) {
    return _.isNil(v) || _.isNil(v[0]) || _.isNil(v[1])
      ? null
      : cache.decorrelate(v as [number, number]);
  },

  compare(config, cache, a, b) {
    throw new Error(`Not implemented`);
  },
};
