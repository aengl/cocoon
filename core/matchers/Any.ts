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
const Any: MatcherObject<AnyConfig> = {
  match(config, cache, sourceItem, targetItem) {
    const matchers = createMatchersFromDefinitions(config);
    for (const m of matchers) {
      const result = m.matcher.match(
        m.config,
        m.cache,
        getSourceValue(m.config, sourceItem),
        getTargetValue(m.config, targetItem)
      );
      if (!_.isNil(result)) {
        return result;
      }
    }
    return null;
  },
};

module.exports = { Any };
