import * as _ from 'lodash';
import { NodeContext, NodeObject } from '..';
import {
  createMatchersFromDefinitions,
  IMatcherConfig,
  Matcher,
  MatcherDefinition,
  MatcherResult,
  MatchInfo,
  MatchResult,
} from '../../matchers';

interface DataRow {
  [name: string]: any;
}

export interface IMatchConfig {
  /**
   * A list of matchers to use to match the collections.
   */
  matchers: Array<MatcherDefinition<IMatchMatcherConfig>>;

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

export interface IMatchMatcherConfig extends IMatcherConfig {
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
  nullConfidence?: number;

  /**
   * The confidence that will be returned in case only one of the values is
   * missing.
   */
  halfConfidence?: number;

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
  },

  process: async context => {
    const source = context.readFromPort<object[]>('source');
    const target = context.readFromPort<object[]>('target');
    const config = context.readFromPort<IMatchConfig>('config');
    const matchResults = match(source, target, config, context.progress);
    context.writeToPort('matches', matchResults);
  },
};

export { Match };

export function match(
  source: object[],
  target: object[],
  config: IMatchConfig,
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
        progress(`matched ${i} item(s)`, i / source.length);
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
        progress(`matched ${i} item(s)`, i / source.length);
      }
      return bestMatches;
    });
  }
  return matchResults;
}

/**
 * Creates an index mapping from the source to the target collection, pointing
 * to the best match in the target collection (or -1 if there was no match).
 * @param matches The matches returned by `match()`.
 */
export function createBestMatchMappings(matches: MatchResult) {
  return matches.map(itemMatchResults =>
    // Find match with the maximum confidence and return its index
    itemMatchResults
      ? itemMatchResults.reduce(
          (best, m) => (m[0] && m[1] > best[1] ? [m[2], m[1]] : best),
          [-1, 0]
        )[0]
      : -1
  );
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
  config: IMatchConfig,
  matchers: Array<Matcher<IMatchMatcherConfig>>,
  sourceItem: DataRow,
  targetItem: DataRow,
  targetIndex: number
): MatchInfo {
  // Run the source & target items through all matchers
  const matchResults = matchers.map(m => {
    const a = sourceItem[(m.config.attribute as any).source];
    const b = targetItem[(m.config.attribute as any).target];
    if (a === undefined && b === undefined) {
      // If both values are undefined, use the null-confidence
      return m.config.nullConfidence || null;
    } else if (a === undefined || b === undefined) {
      // If only one value is undefined, use the half-confidence
      return m.config.halfConfidence || null;
    }
    // Run matcher and convert confidence to a numeric value, applying the
    // weight in the process
    const confidence = m.matcher.match(m.config, a, b);
    const weight = m.config.weight || 1;
    if (confidence === null) {
      return null;
    } else if (_.isBoolean(confidence)) {
      return confidence ? weight : 0;
    }
    return confidence * weight;
  });

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
