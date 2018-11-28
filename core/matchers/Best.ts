import _ from 'lodash';
import {
  createMatchersFromDefinitions,
  getSourceValue,
  getTargetValue,
  MatcherDefinition,
  MatcherObject,
  MatcherResult,
} from '.';

type BestConfig = MatcherDefinition[];

/**
 * Returns the best result of the sub-matchers.
 */
const Best: MatcherObject<BestConfig> = {
  match(config, sourceItem, targetItem): MatcherResult {
    const matchers = createMatchersFromDefinitions(config);
    const matchResults = matchers.map(m =>
      m.matcher.match(
        m.config,
        getSourceValue(m.config, sourceItem),
        getTargetValue(m.config, targetItem)
      )
    );
    return _.max(matchResults);
  },
};

module.exports = { Best };
