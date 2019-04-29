import _ from 'lodash';
import {
  createMatchersFromDefinitions,
  getSourceValue,
  getTargetValue,
  MatcherDefinition,
  MatcherObject,
} from '.';

export type BestConfig = MatcherDefinition[];

/**
 * Returns the best result of the sub-matchers.
 */
export const Best: MatcherObject<BestConfig> = {
  match(config, cache, sourceItem, targetItem) {
    const matchers = createMatchersFromDefinitions(config);
    const matchResults = matchers.map(matcher =>
      matcher.object.match(
        matcher.config,
        matcher.cache,
        getSourceValue(matcher.config, sourceItem),
        getTargetValue(matcher.config, targetItem)
      )
    );
    return _.max(matchResults);
  },
};
