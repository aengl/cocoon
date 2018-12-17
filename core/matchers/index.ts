import _ from 'lodash';

const matchers = _.merge(
  {},
  require('./Any'),
  require('./Best'),
  require('./Exact'),
  require('./SomeExact'),
  require('./Levenshtein'),
  require('./Numeric'),
  require('./String')
);

/**
 * Represents a matcher definition.
 */
export interface MatcherDefinition<T extends MatcherConfig = MatcherConfig> {
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
export interface MatcherConfig {
  /**
   * Specifies the source and target attributes for the matching process.
   *
   * If left undefined, the entire data object will be passed instead.
   */
  attribute?: { source: string; target: string };
}

/**
 * Common interface for all matchers.
 *
 * A matcher compares two values and determines the confidence for those two
 * values to be the same. Matchers use different techniques to account for
 * uncertainties (spelling mistakes, different units, inaccuracies, etc.).
 */
export interface MatcherObject<ConfigType = MatcherConfig, CacheType = null> {
  /**
   * Can optionally be used to pre-compile some resources in order to speed up
   * the matching.
   */
  cache?(config: ConfigType): CacheType;

  /**
   * Compares two values and returns the confidence.
   *
   * When returning a boolean it will be interpreted as 0.0 (false) or 1.0
   * (true).
   */
  match(config: ConfigType, cache: CacheType, a: any, b: any): MatcherResult;
}

/**
 * A matcher instance.
 */
export interface Matcher<ConfigType = MatcherConfig, CacheType = null> {
  cache: CacheType;
  config: ConfigType;
  matcher: MatcherObject<ConfigType>;
  type: string;
}

/**
 * A number means match confidence (0.0 to 1.0).
 *
 * False means no match (equivalent to 0.0), true is a match (equivalent to
 * 1.0).
 *
 * Nil means that the meatcher could not compare the result (usually because
 * one or more values are missing).
 *
 * Unless the matcher configuration specifies otherwise, 0 or false will fail a
 * match. Nil will not prevent the match from succeeding, but will have a
 * negative impact on the mean confidence.
 */
export type MatcherResult = boolean | number | null | undefined;

/**
 * An array in the form of: [itemsMatch, confidence, targetIndex, matchResults]
 *
 * itemsMatch: The consolidated result of the match.
 * confidence: The consolidated confidence of the match.
 * targetIndex: The data index of the matched item (target).
 * matchResults: Results of the individual matchers.
 */
export type MatchInfo = [boolean, number, number, MatcherResult[]];

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
    const matcher = getMatcher(type);
    return {
      cache: matcher.cache === undefined ? null : matcher.cache(config),
      config,
      matcher,
      type,
    };
  });
}

/**
 * Looks up the corresponding matcher by its type name.
 * @param type The matcher type.
 */
export function getMatcher<ConfigType = MatcherConfig, CacheType = null>(
  type: string
): MatcherObject<ConfigType, CacheType> {
  const matcher = matchers[type];
  if (!matcher) {
    throw new Error(`matcher type does not exist: ${type}`);
  }
  return matcher;
}

export function getSourceValue(config: MatcherConfig, sourceItem: object) {
  const attribute = config.attribute ? config.attribute.source : undefined;
  return attribute === undefined ? sourceItem : sourceItem[attribute];
}

export function getTargetValue(config: MatcherConfig, targetItem: object) {
  const attribute = config.attribute ? config.attribute.target : undefined;
  return attribute === undefined ? targetItem : targetItem[attribute];
}

/**
 * Creates an index mapping from the source to the target collection, pointing
 * to all matches (sorted by confidence) in the target collection.
 * @param matches The matches returned by `match()`.
 */
export function createBestMatchMappings(matches: MatchResult) {
  return matches.map(itemMatchResults =>
    itemMatchResults
      ? _.orderBy(
          itemMatchResults.filter(m => m[0] === true),
          m => m[1],
          'desc'
        ).map(m => m[2])
      : []
  );
}
