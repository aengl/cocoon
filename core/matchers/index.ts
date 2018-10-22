import _ from 'lodash';

const matchers = _.merge(
  {},
  require('./Exact'),
  require('./Levenshtein'),
  require('./Numeric')
);

export interface DataRow {
  [name: string]: any;
}

/**
 * A number means match confidence (0.0 to 1.0).
 *
 * False means no match (equivalent to 0.0), true is a match (equivalent to
 * 1.0).
 *
 * Null means that the meatcher could not compare the result (usually because
 * one or more values are missing).
 *
 * Unless the matcher specifies otherwise, 0 or false will fail a match. Null
 * will not prevent the match from succeeding, but will have a negative impact
 * on the mean confidence.
 */
export type MatchResult = boolean | number | null;

/**
 * Represents a matcher definition.
 */
export interface MatcherDefinition {
  /**
   * Maps the module name to its configuration.
   */
  [moduleName: string]: MatcherConfig;
}

/**
 * The configuration for a Cocoon matcher.
 *
 * A matcher compares a source attribute with a target attribute and calculates
 * a `MatchResult`.
 */
export interface MatcherConfig {
  /**
   * Name of the source attribute whose value will be compared.
   */
  sourceAttribute?: string;

  /**
   * Name of the target attribute whose value will be compared.
   */
  targetAttribute?: string;

  /**
   * If `sourceAttribute` and `targetAttribute` are identical, this can be used
   * as a shorthand.
   */
  attribute?: string;

  /**
   * If the MatcherResult does not have at least this confidence, the entire
   * match will be discarded.
   */
  confidence?: MatchResult;

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
 * Common interface for all matchers.
 *
 * A matcher compares two values and determines the confidence for those two
 * values to be the same. Matchers use different techniques to account for
 * uncertainties (spelling mistakes, different units, inaccuracies, etc.).
 */
export interface IMatcher<T extends MatcherConfig = MatcherConfig> {
  /**
   * Compares two values and returns the confidence.
   *
   * When returning a boolean it will be interpreted as 0.0 (false) or 1.0
   * (true).
   */
  match(config: T, a: any, b: any): MatchResult;
}

/**
 * An array in the form of: [itemsMatch, confidence, matchResults]
 *
 * itemsMatch: The consolidated result of the match.
 * confidence: The consolidated confidence of the match.
 * matchResults: Results of the individual matchers.
 */
export type MatchInfo = [boolean, number, MatchResult[]];

export function getMatcher<T>(type: string): IMatcher<T> {
  const matcher = matchers[type];
  if (!matcher) {
    throw new Error(`matcher type does not exist: ${type}`);
  }
  return matcher;
}
