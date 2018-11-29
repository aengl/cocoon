import * as _ from 'lodash';
import { isMetaKey } from '../../../common/data';
import { NodeObject } from '../../../common/node';
import { createBestMatchMappings, MatchResult } from '../../matchers';

export interface MergeConfig {
  /**
   * When merging two matched items, the strategy will dictate how deviating
   * values are handled.
   */
  strategy?: MergeStrategy;

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

/**
 * Merges two or more collections into one.
 */
const Merge: NodeObject = {
  in: {
    config: {
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
    const source = context.readFromPort<object[]>('source');
    const target = context.readFromPort<object[]>('target');
    const config = context.readFromPort<MergeConfig>('config');
    const matches = context.readFromPort<MatchResult>('matches');
    const diff = createDiff(config, source, target, matches);
    context.writeToPort('data', merge(matches, source, target, config));
    context.writeToPort('diff', diff);
    return `Merged ${diff.length} items`;
  },
};

export { Merge };

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
  source: object[],
  target: object[],
  config: MergeConfig
) {
  const mappings = createBestMatchMappings(matches);
  // Map all entries in the match table to the merge result
  return (
    mappings
      .map((targetIndex, sourceIndex) => {
        if (targetIndex === -1) {
          // targetIndex of -1 means that the item could not be matched
          return config.dropUnmatched ? null : source[sourceIndex];
        }
        const mergedItem = mergeItems(
          source[sourceIndex],
          target[targetIndex],
          config.strategy
        );
        if (config.matchInfo !== undefined) {
          mergedItem[config.matchInfo] = matches[sourceIndex]![targetIndex];
        }
        return mergedItem;
      })
      // Get rid of items that couldn't be matched
      // Doing it after the mapping to preserve the indices
      .filter(mergedItem => mergedItem !== null)
  );
}

export function createDiff(
  config: MergeConfig,
  source: object[],
  target: object[],
  matches: MatchResult
) {
  return _.sortBy(
    createBestMatchMappings(matches)
      .map((targetIndex, sourceIndex) =>
        createDiffBetweenItems(
          config,
          sourceIndex,
          source[sourceIndex],
          targetIndex,
          target[targetIndex]
        )
      )
      .filter(diff => diff !== null),
    (itemDiff: MergeDiff) => -itemDiff.different.length + itemDiff.equal.length
  );
}

function createDiffBetweenItems(
  config: MergeConfig,
  sourceIndex: number,
  sourceItem: object,
  targetIndex: number,
  targetItem: object
): MergeDiff | null {
  if (targetIndex < 0) {
    // Items do not match
    return null;
  }
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
