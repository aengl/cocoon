import _ from 'lodash';
import { linearRegression, linearRegressionLine } from 'simple-statistics';
import { Metric } from '.';

export interface DecorrelateCache {
  decorrelate: (x: [number | null, number | null]) => number | null;
}

export interface DecorrelateConfig {
  attributes: string[];

  /**
   * Default value for the second attribute, if null.
   */
  default?: number;
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
  pick(config, item, attribute) {
    return [item[config.attributes[0]], item[config.attributes[1]]];
  },

  cache(config, values, debug) {
    const filteredValues = values.filter(
      x => !_.isNil(x) && !_.isNil(x[0]) && !_.isNil(x[1])
    ) as Array<[number, number]>;
    // Train a regression that predicts a-values based on b-values
    const regressionLine = linearRegressionLine(
      linearRegression(filteredValues.map(x => [x[1], x[0]]))
    );
    return {
      decorrelate: v =>
        _.isNil(v[0])
          ? null
          : _.isNil(v[1])
          ? config.default === undefined
            ? v[0]
            : v[0] + (v[0] - regressionLine(config.default)) / 2
          : // Predict a-value and adjust it based on the error
            v[0] + (v[0] - regressionLine(v[1])) / 2,
    };
  },

  score(config, cache, v) {
    return cache.decorrelate(v as [number, number]);
  },

  distance(config, cache, a, b) {
    throw new Error(`Not implemented`);
  },
};
