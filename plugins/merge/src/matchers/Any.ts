import _ from 'lodash';
import {
  createMatchersFromDefinitions,
  getSourceValue,
  getTargetValue,
  MatcherDefinition,
  MatcherObject,
} from '.';

export type AnyConfig = MatcherDefinition[];

/**
 * Returns the first non-nil result of the sub-matchers. It is essentially an
 * OR-chain of matchers.
 */
export const Any: MatcherObject<AnyConfig> = {
  match(config, cache, sourceItem, targetItem) {
    const matchers = createMatchersFromDefinitions(config);
    for (const matcher of matchers) {
      const result = matcher.object.match(
        matcher.config,
        matcher.cache,
        getSourceValue(matcher.config, sourceItem),
        getTargetValue(matcher.config, targetItem)
      );
      if (!_.isNil(result)) {
        return result;
      }
    }
    return null;
  },
};
