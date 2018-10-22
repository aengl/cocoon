import _ from 'lodash';

const matchers = _.merge(
  {},
  require('./Exact'),
  require('./Levenshtein'),
  require('./Numeric')
);

/**
 * Represents a matcher definition.
 */
export interface MatcherDefinition<T extends IMatcherConfig = IMatcherConfig> {
  /**
   * Maps the module name to its configuration.
   */
  [moduleName: string]: T;
}

/**
 * The configuration for a Cocoon matcher.
 *
 * A matcher compares a source attribute with a target attribute and calculates
 * a `MatchResult`.
 */
export interface IMatcherConfig {
  /**
   * Specifies the source and target attributes for the matching process. Can be
   * a string if both attributes share the same name.
   */
  attribute: string | { source: string; target: string };
}

/**
 * Common interface for all matchers.
 *
 * A matcher compares two values and determines the confidence for those two
 * values to be the same. Matchers use different techniques to account for
 * uncertainties (spelling mistakes, different units, inaccuracies, etc.).
 */
export interface IMatcher<T = {}> {
  /**
   * Compares two values and returns the confidence.
   *
   * When returning a boolean it will be interpreted as 0.0 (false) or 1.0
   * (true).
   */
  match(config: T, a: any, b: any): MatcherResult;
}

/**
 * A matcher instance.
 */
export interface Matcher<T extends IMatcherConfig = IMatcherConfig> {
  config: T;
  matcher: IMatcher<T>;
  type: string;
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
export type MatcherResult = boolean | number | null;

/**
 * An array in the form of: [itemsMatch, confidence, matchResults]
 *
 * itemsMatch: The consolidated result of the match.
 * confidence: The consolidated confidence of the match.
 * matchResults: Results of the individual matchers.
 */
export type MatchInfo = [boolean, number, MatcherResult[]];

/**
 * The resulting data from matching two collections. Contains all the necessary
 * information to merge the collections.
 */
export type MatchResult = Array<MatchInfo[] | null>;

/**
 * Creates instances of all matchers in the definitions.
 */
export function createMatchersFromDefinitions(
  definitions: MatcherDefinition[]
): Matcher[] {
  return definitions.map(matcherDefinition => {
    const type = Object.keys(matcherDefinition)[0];
    const config = matcherDefinition[type];
    config.attribute = readAttributes(config);
    return {
      config,
      matcher: getMatcher(type),
      type,
    };
  });
}

export function getMatcher<T extends IMatcherConfig>(
  type: string
): IMatcher<T> {
  const matcher = matchers[type];
  if (!matcher) {
    throw new Error(`matcher type does not exist: ${type}`);
  }
  return matcher;
}

/**
 * Determines the attribute used for matching the source with the target, given
 * a matcher configuration.
 * @param config The matcher configuration.
 * @param debug An instance of the `debug` module. Will be used to print a
 * descriptive error.
 */
function readAttributes(config: IMatcherConfig) {
  if (config.attribute === undefined) {
    throw new Error(
      `source or target attribute missing in matcher configuration`
    );
  }
  if (_.isString(config.attribute)) {
    return {
      source: config.attribute,
      target: config.attribute,
    };
  }
  return config.attribute;
}
