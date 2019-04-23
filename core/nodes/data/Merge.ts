import _ from 'lodash';
import { isMetaKey } from '../../../common/data';
import { NodeObject } from '../../../common/node';
import {
  getSourceIndex,
  getTargetIndex,
  MatchInfo,
  MatchResult,
  getMatchedIndexSet,
} from '../../matchers';

export interface MergeConfig {
  /**
   * When merging two matched items, the strategy will dictate how deviating
   * values are handled.
   */
  strategy?: MergeStrategy;

  /**
   * Merges the target data into an attribute with the specified name. The
   * `strategy` will be used to determine what happens if that attribute already
   * exists (use `MergeStrategy.append` to collect multiple matches in an
   * array).
   */
  into?: string;

  /**
   * If defined, will write the matching information to the attribute with the
   * specified name.
   */
  matchInfo?: string;

  /**
   * By default, merging will perform a "left join", meaning it will keep
   * unmatched items in the merged data.
   *
   * If this parameter is set to true, items that were not matched will be
   * filtered instead.
   */
  dropUnmatched?: boolean;

  /**
   * If true, all matches will be merged, not just the best one.
   */
  mergeMultiple?: boolean;

  id?: string;
}

export interface MergeDiff {
  id: string;

  sourceIndex: number;

  targetIndex: number;

  equal: Array<[string, any]>;

  different: Array<[string, any, any]>;

  numOnlyInSource: number;

  numOnlyInTarget: number;
}

interface SourceItem {
  $matches?: MatchResult[];
  $numMatched?: number;
  $numMerged?: number;
}

/**
 * Determines how items are merged when they have one or more of the same keys,
 * but the values for those keys differ.
 */
enum MergeStrategy {
  /**
   * Preserves both values by turning them into an array.
   */
  Append = 'append',

  /**
   * Overwrite the value in the source collection with the one in the target
   * collection.
   */
  Overwrite = 'overwrite',

  /**
   * Preserves the values in the source collection.
   *
   * This is the default strategy.
   */
  Preserve = 'preserve',
}

export interface Ports {
  config: MergeConfig;
  matches: MatchResult;
  source: object[];
  target: object[];
}

/**
 * Merges two or more collections into one.
 */
export const Merge: NodeObject<Ports> = {
  category: 'Data',

  in: {
    config: {
      hide: true,
      required: true,
    },
    matches: {
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
    data: {},
    diff: {},
  },

  async process(context) {
    const { config, matches, source, target } = context.ports.read();
    const diff = createDiff(config, source, target, matches);
    const data = merge(matches, source, target, config);
    context.ports.write({ data, diff });
    return `Matched ${matches.length} items in source`;
  },
};

/**
 * Gets all keys that are either in the source or the target item, without
 * duplicates.
 */
const getKeys = (
  sourceItem: object,
  targetItem: object,
  predicate: (key: string) => boolean
) =>
  _.union(
    Object.keys(sourceItem).filter(key => predicate(key)),
    Object.keys(targetItem).filter(key => predicate(key))
  );

export function merge(
  matches: MatchResult,
  source: SourceItem[],
  target: object[],
  config: MergeConfig
) {
  if (config.dropUnmatched) {
    return matches.map(itemMatches =>
      createMergedObjectFromMatches(itemMatches, source, target, config)
    );
  }
  // In case we want to keep all items in source, we need to create a lookup
  // table so we can find the matches for each item as we map the source
  const sourceIndexToMatches = matches.reduce((all, itemMatches) => {
    const sourceIndex = getSourceIndex(itemMatches[0]);
    all[sourceIndex] = itemMatches;
    return all;
  }, {});
  return source.map((sourceItem, sourceIndex) =>
    sourceIndexToMatches[sourceIndex] === undefined
      ? sourceItem
      : createMergedObjectFromMatches(
          sourceIndexToMatches[sourceIndex],
          source,
          target,
          config
        )
  );
}
export function createDiff(
  config: MergeConfig,
  source: object[],
  target: object[],
  matches: MatchResult
) {
  const diffs = _.flatten(
    matches
      .map((itemMatches, sourceIndex) =>
        itemMatches
          .map(getTargetIndex)
          .map(targetIndex =>
            createDiffBetweenItems(
              config,
              sourceIndex,
              source[sourceIndex],
              targetIndex,
              target[targetIndex]
            )
          )
      )
      .filter(diff => diff.length)
  );
  return _.sortBy(
    diffs,
    (itemDiff: MergeDiff) => -itemDiff.different.length + itemDiff.equal.length
  );
}

/**
 * Returns all source items that were not matched.
 */
export function getUnmatchedSource(source: any[], matches: MatchResult) {
  const matchedIndices = getMatchedIndexSet(matches, getSourceIndex);
  return source.filter((item, i) => !matchedIndices.has(i));
}

/**
 * Returns all target items that were not matched.
 */
export function getUnmatchedTarget(target: any[], matches: MatchResult) {
  const matchedIndices = getMatchedIndexSet(matches, getTargetIndex);
  return target.filter((item, i) => !matchedIndices.has(i));
}

/**
 * Gets the result of merging two values using the `append` strategy.
 */
function append(sourceValue: any, targetValue: any) {
  if (sourceValue === undefined) {
    // Add values that are missing in source
    return targetValue;
  } else if (
    targetValue !== undefined &&
    !_.isEqual(sourceValue, targetValue)
  ) {
    // Merge values if they're not identical
    return [sourceValue, targetValue];
  }
  return sourceValue;
}

function createMergedObjectFromMatches(
  matches: MatchInfo[],
  source: SourceItem[],
  target: object[],
  config: MergeConfig
) {
  const sourceIndex = getSourceIndex(matches[0]); // Source index is the same across all matches
  const targetIndices = matches.map(getTargetIndex);
  const targetIndicesToMerge = config.mergeMultiple
    ? targetIndices
    : targetIndices.slice(0, 1);
  // source[sourceIndex].$numMatched = targetIndices.length;
  // source[sourceIndex].$numMerged = 0;
  const mergedItem = targetIndicesToMerge.reduce(
    (itemBeingMerged, targetIndex) => {
      // itemBeingMerged.$numMerged! += 1;
      const item = config.into
        ? mergeInto(
            itemBeingMerged,
            target[targetIndex],
            config.into,
            config.strategy
          )
        : mergeItems(itemBeingMerged, target[targetIndex], config.strategy);
      return item;
    },
    // Clone source object, so we don't modify the source data
    { ...source[sourceIndex] }
  );
  // _.set(mergedItem, '$matches', matches[sourceIndex]);
  return mergedItem;
}

/**
 * Merges two items.
 * @param sourceItem An item from the collection that initiated the merge.
 * @param targetItem An item from the collection that was matched with the
 * collection that is being merged.
 * @param strategy The stragety used when merging (see MergeStrategy).
 */
function mergeItems(
  sourceItem: object,
  targetItem: object,
  strategy?: MergeStrategy
): object {
  let result: object;

  // Merge normal keys using the merge strategy
  if (strategy === MergeStrategy.Append) {
    const keys = getKeys(sourceItem, targetItem, key => !isMetaKey(key));
    result = keys.reduce((merged: object, key) => {
      merged[key] = append(sourceItem[key], targetItem[key]);
      return merged;
    }, {});
  } else if (strategy === MergeStrategy.Overwrite) {
    result = _.assign({}, sourceItem, targetItem);
  } else {
    result = _.assign({}, targetItem, sourceItem);
  }

  // Concatenate meta keys
  const metaKeys = getKeys(sourceItem, targetItem, key => isMetaKey(key));
  metaKeys.forEach(key => {
    result[key] = _.concat([], sourceItem[key], targetItem[key]);
  });

  return result;
}

function mergeInto(
  sourceItem: object,
  targetItem: object,
  attribute: string,
  strategy?: MergeStrategy
): object {
  if (strategy === MergeStrategy.Append) {
    const existingValue: any[] | undefined = sourceItem[attribute];
    if (existingValue !== undefined) {
      existingValue.push(targetItem);
    } else {
      sourceItem[attribute] = _.castArray(targetItem);
    }
    return sourceItem;
  }
  return mergeItems(sourceItem[attribute], targetItem, strategy);
}

function createDiffBetweenItems(
  config: MergeConfig,
  sourceIndex: number,
  sourceItem: object,
  targetIndex: number,
  targetItem: object
): MergeDiff | null {
  const diff: MergeDiff = {
    different: [],
    equal: [],
    id: config.id
      ? sourceItem[config.id]
      : sourceItem[Object.keys(sourceItem)[0]],
    numOnlyInSource: 0,
    numOnlyInTarget: 0,
    sourceIndex,
    targetIndex,
  };
  const keys = getKeys(sourceItem, targetItem, key => !isMetaKey(key));
  keys.forEach(key => {
    const a = sourceItem[key];
    const b = targetItem[key];
    const aIsNil = _.isNil(a);
    const bIsNil = _.isNil(b);
    if (!aIsNil && bIsNil) {
      diff.numOnlyInSource += 1;
    } else if (aIsNil && !bIsNil) {
      diff.numOnlyInTarget += 1;
    } else if (aIsNil && bIsNil) {
      // Ignore
    } else if (a === b) {
      diff.equal.push([key, a]);
    } else {
      diff.different.push([key, a, b]);
    }
  });
  return diff;
}
