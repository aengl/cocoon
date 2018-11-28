import _ from 'lodash';
import {
  createMatchersFromDefinitions,
  getSourceValue,
  getTargetValue,
  MatcherDefinition,
  MatcherObject,
} from '.';

type BestConfig = MatcherDefinition[];

/**
 * Returns the best result of the sub-matchers.
 */
const Best: MatcherObject<BestConfig> = {
  match(config, cache, sourceItem, targetItem) {
    const matchers = createMatchersFromDefinitions(config);
    const matchResults = matchers.map(m =>
      m.matcher.match(
        m.config,
        m.cache,
        getSourceValue(m.config, sourceItem),
        getTargetValue(m.config, targetItem)
      )
    );
    return _.max(matchResults);
  },
};

module.exports = { Best };
