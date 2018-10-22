import * as _ from 'lodash';
import { ICocoonNode, readInputPort, writeOutput } from '..';
import {
  createMatchersFromDefinitions,
  IMatcherConfig,
  Matcher,
  MatcherDefinition,
  MatcherResult,
  MatchInfo,
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
const Match: ICocoonNode<IMatchConfig> = {
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
    const { config, node } = context;
    const source = readInputPort(node, 'source') as object[];
    const target = readInputPort(node, 'target') as object[];

    // Create matchers
    const matchers = createMatchersFromDefinitions(config.matchers);

    // Create match results for all items
    let matchResults: Array<MatchInfo[] | null>;

    if (config.findBest === undefined) {
      matchResults = source.map(sourceItem => {
        for (const targetItem of target) {
          const matchInfo = match(config, matchers, sourceItem, targetItem);
          if (matchInfo[0]) {
            return [matchInfo];
          }
        }
        return null;
      });
    } else {
      matchResults = [];
      matchResults = source.map(sourceItem =>
        // Sort match info by confidence and take the top n items
        _.sortBy(
          target.map(targetItem =>
            match(config, matchers, sourceItem, targetItem)
          ),
          x => x[1]
        ).slice(0, _.isNumber(config.findBest) ? config.findBest : 1)
      );
    }

    writeOutput(node, 'matches', matchResults);
  },
};

export { Match };

/**
 * Determines the match confidence between two data items.
 * @param config The matcher plugin configuration.
 * @param matchers Instance of the individual matchers.
 * @param sourceItem The item being matched in the source dataset.
 * @param targetItem The item being matched in the target dataset.
 */
function match(
  config: IMatchConfig,
  matchers: Array<Matcher<IMatchMatcherConfig>>,
  sourceItem: DataRow,
  targetItem: DataRow
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
  return [itemsMatch, meanConfidence, matchResults];
}
