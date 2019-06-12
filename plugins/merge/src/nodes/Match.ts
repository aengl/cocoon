import { CocoonNode, CocoonNodeContext } from '@cocoon/types';
import _ from 'lodash';
import {
  createMatchersFromDefinitions,
  getConfidence,
  getSourceValue,
  getTargetValue,
  Matcher,
  MatcherConfig,
  MatcherDefinition,
  MatcherResult,
  MatchInfo,
  MatchResult,
} from '../matchers';

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
   * If true, calculate all match results.
   *
   * If left undefined, the first match is taken (which is not necessarily the
   * best).
   */
  findAll?: boolean | number;

  /**
   * If defined, keep n results with the highest confidence (if set to `true`, n
   * is 1) that were failed matches. Useful for analysis.
   *
   * If left undefined, only matches are kept.
   */
  keepClosest: number;
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

export interface Ports {
  config: string | MatchConfig;
  source: object[];
  target: object[];
}

export const Match: CocoonNode<Ports> = {
  category: 'Data',
  description: `Matches two collections.`,

  in: {
    config: {
      hide: true,
      required: true,
    },
    source: {
      required: true,
    },
    target: {
      required: true,
    },
  },

  out: {
    matches: {},
  },

  async process(context) {
    const { config, source, target } = context.ports.read();
    const matchConfig = await context.uri.resolveYaml<MatchConfig>(config, {
      root: context.definitions.root,
    });
    const matches = match(source, target, matchConfig, context.progress);
    context.ports.write({ matches });
  },
};

export function match(
  source: object[],
  target: object[],
  config: MatchConfig,
  progress: CocoonNodeContext['progress']
): MatchResult {
  // Create matchers
  const matchers = createMatchersFromDefinitions(config.matchers);

  // Create match results for all items
  let matchResults: Array<MatchInfo[] | null>;
  if (!config.findAll) {
    matchResults = source.map((sourceItem, i) => {
      progress(`Matched ${i} items`, i / source.length);

      // Take the first match
      let targetIndex = 0;
      for (const targetItem of target) {
        const matchInfo = matchItem(
          config,
          matchers,
          sourceItem,
          i,
          targetItem,
          targetIndex
        );
        if (matchInfo[0]) {
          return [matchInfo];
        }
        targetIndex += 1;
      }
      return null;
    });
  } else {
    matchResults = source.map((sourceItem, i) => {
      progress(`Matched ${i} items`, i / source.length);

      // Sort match info by confidence and take the top n items
      const results = target.map((targetItem, targetIndex) =>
        matchItem(config, matchers, sourceItem, i, targetItem, targetIndex)
      );
      const numMatches = results.filter(x => x[0] === true).length;
      const sortedResults = _.orderBy(results, getConfidence, 'desc');
      const bestMatches = sortedResults.slice(
        0,
        config.keepClosest === undefined
          ? numMatches
          : numMatches + config.keepClosest
      );
      return bestMatches.length > 0 ? bestMatches : null;
    });
  }

  // Return compacted results
  return _.compact(matchResults);
}

/**
 * Determines the match confidence between two data items.
 * @param config The matcher plugin configuration.
 * @param matchers Instance of the individual matchers.
 * @param sourceItem The item being matched in the source dataset.
 * @param sourceIndex The data index of the source item.
 * @param targetItem The item being matched in the target dataset.
 * @param targetIndex The data index of the target item.
 */
function matchItem(
  config: MatchConfig,
  matchers: Array<Matcher<ExtendedMatcherConfig>>,
  sourceItem: object,
  sourceIndex: number,
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
  return [itemsMatch, meanConfidence, sourceIndex, targetIndex, matchResults];
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
  const confidence = matcher.object.match(matcher.config, matcher.cache, a, b);
  const weight = matcher.config.weight || 1;
  if (_.isNil(confidence)) {
    return null;
  } else if (_.isBoolean(confidence)) {
    return confidence ? weight : 0;
  }
  return confidence * weight;
}
