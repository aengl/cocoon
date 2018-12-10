import * as _ from 'lodash';
import { NodeContext, NodeObject } from '../../../common/node';
import {
  createMatchersFromDefinitions,
  getSourceValue,
  getTargetValue,
  Matcher,
  MatcherConfig,
  MatcherDefinition,
  MatcherResult,
  MatchInfo,
  MatchResult,
} from '../../matchers';

export interface MatchConfig {
  /**
   * A list of matchers to use to match the collections.
   */
  matchers: Array<MatcherDefinition<ExtendedMatcherConfig>>;

  /**
   * Minimum confidence necessary before considering two items a match.
   *
   * If not specified, two items will be considered matching as long as no
   * single matcher returns a confidence of 0 (or false).
   *
   * Confidence values of individual matches can range from 0.0 to 1.0, where
   * boolean values translate into 0.0 (for false) and 1.0 (for true). The
   * confidence of all matchers is then averaged and compared against this
   * value.
   */
  confidence?: number;

  /**
   * If defined, find the n matches with the highest confidence (if set to
   * `true`, n is 1).
   *
   * If left undefined, the first match is taken.
   */
  findBest?: boolean | number;
}

export interface ExtendedMatcherConfig extends MatcherConfig {
  /**
   * If the MatcherResult does not have at least this confidence, the entire
   * match will be discarded.
   */
  confidence?: MatcherResult;

  /**
   * The confidence that will be returned in case both values are missing.
   *
   * The reason this is useful is because two items are more likely to match if
   * neither of them have a feature, instead of just one of them having it.
   * Especially in case of features that are seldomly defined.
   */
  confidenceIfBothMissing?: number;

  /**
   * The confidence that will be returned in case only one of the values is
   * missing.
   */
  confidenceIfOneMissing?: number;

  /**
   * A matcher with a high weight (> 1) factors more heavily into the confidence
   * calculation.
   */
  weight?: number;
}

/**
 * Matches two collections.
 */
const Match: NodeObject = {
  in: {
    source: {
      required: true,
    },
    target: {
      required: true,
    },
  },

  out: {
    matches: {},
    unmatched: {},
  },

  async process(context) {
    const source = context.readFromPort<object[]>('source');
    const target = context.readFromPort<object[]>('target');
    const config = context.readFromPort<MatchConfig>('config');
    const matches = match(source, target, config, context.progress);
    context.writeToPort('matches', matches);
    context.writeToPort('unmatched', findUnmatched(source, matches));
  },
};

export { Match };

export function match(
  source: object[],
  target: object[],
  config: MatchConfig,
  progress?: NodeContext['progress']
): MatchResult {
  // Create matchers
  const matchers = createMatchersFromDefinitions(config.matchers);

  // Create match results for all items
  let matchResults: Array<MatchInfo[] | null>;
  if (config.findBest === undefined) {
    matchResults = source.map((sourceItem, i) => {
      // Take the first match
      let result: MatchInfo[] | null = null;
      let targetIndex = 0;
      for (const targetItem of target) {
        const matchInfo = matchItem(
          config,
          matchers,
          sourceItem,
          targetItem,
          targetIndex
        );
        if (matchInfo[0]) {
          result = [matchInfo];
          break;
        }
        targetIndex += 1;
      }
      if (progress !== undefined && i % 100 === 0) {
        progress(`Matched ${i} items`, i / source.length);
      }
      return result;
    });
  } else {
    matchResults = source.map((sourceItem, i) => {
      // Sort match info by confidence and take the top n items
      const matches = target.map((targetItem, targetIndex) =>
        matchItem(config, matchers, sourceItem, targetItem, targetIndex)
      );
      const sortedMatches = _.sortBy(matches, x => -x[1]);
      const bestMatches = sortedMatches.slice(
        0,
        _.isNumber(config.findBest) ? config.findBest : 1
      );
      if (progress !== undefined && i % 25 === 0) {
        progress(`Matched ${i} items`, i / source.length);
      }
      return bestMatches;
    });
  }
  return matchResults;
}

/**
 * Finds items in the source collection that were not matched.
 * @param source The source dataset.
 * @param matches The match results.
 */
export function findUnmatched(source: object[], matches: MatchResult) {
  return matches
    .map(m => m === null || !m.some(x => x[0] === true))
    .map((x, i) => (x ? { ...source[i], $match: matches[i] } : null))
    .filter(x => x !== null);
}

/**
 * Determines the match confidence between two data items.
 * @param config The matcher plugin configuration.
 * @param matchers Instance of the individual matchers.
 * @param sourceItem The item being matched in the source dataset.
 * @param targetItem The item being matched in the target dataset.
 * @param targetIndex The data index of the target item.
 */
function matchItem(
  config: MatchConfig,
  matchers: Array<Matcher<ExtendedMatcherConfig>>,
  sourceItem: object,
  targetItem: object,
  targetIndex: number
): MatchInfo {
  // Run the source & target items through all matchers
  const matchResults = matchers.map(m =>
    calculateConfidence(m, sourceItem, targetItem)
  );

  // Check if confidence criteria were not met
  const requirementsUnmet = matchers
    // In JS, when boolean values are compared to numbers, "false" is treated as
    // 0 and "true" is treated as 1, which aligns precisely with our
    // interpretation.
    .map(
      (m, i) =>
        // If no match could be determined, proceed
        matchResults[i] === null ||
        // If there's a confidence requirement, make sure it is met
        _.isNil(m.config.confidence) ||
        matchResults[i]! >= m.config.confidence
    )
    .some(x => x === false);

  // Create array with only numeric confidence values
  const confidences = matchResults.filter(x => x !== null) as number[];

  // Return average confidence. Null-matches need to be counted as well, since
  // they contribute to uncertainty in the matching. The confidence is
  // normalised by the sum of all weights.
  const meanConfidence =
    _.sum(confidences) / _.sumBy(matchers, c => c.config.weight || 1);

  // Require average confidence to be above or equal to the minimum
  const itemsMatch =
    meanConfidence > 0 && // Require at least *some* confidence for the match
    !requirementsUnmet && // Matcher requirements must be met
    (config.confidence // Confidence requirement must be met
      ? meanConfidence >= config.confidence
      : confidences.reduce((a, b) => a && b > 0, true));
  return [itemsMatch, meanConfidence, targetIndex, matchResults];
}

/**
 * Calculates the confidence for a single match.
 * @param matcher The matcher instance.
 * @param sourceItem The item being matched in the source dataset.
 * @param targetItem The item being matched in the target dataset.
 * @returns A confidence between 0 and 1, or null if one of the values was
 * missing.
 */
function calculateConfidence(
  matcher: Matcher<ExtendedMatcherConfig>,
  sourceItem: object,
  targetItem: object
) {
  const a = getSourceValue(matcher.config, sourceItem);
  const b = getTargetValue(matcher.config, targetItem);
  if (a === undefined && b === undefined) {
    return matcher.config.confidenceIfBothMissing === undefined
      ? null
      : matcher.config.confidenceIfBothMissing;
  } else if (a === undefined || b === undefined) {
    return matcher.config.confidenceIfOneMissing === undefined
      ? null
      : matcher.config.confidenceIfOneMissing;
  }

  // Run matcher and convert confidence to a numeric value, applying the
  // weight in the process
  const confidence = matcher.matcher.match(matcher.config, matcher.cache, a, b);
  const weight = matcher.config.weight || 1;
  if (_.isNil(confidence)) {
    return null;
  } else if (_.isBoolean(confidence)) {
    return confidence ? weight : 0;
  }
  return confidence * weight;
}
