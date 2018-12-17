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
    const source = context.readFromPort<SourceItem[]>('source');
    const target = context.readFromPort<object[]>('target');
    const config = context.readFromPort<MergeConfig>('config');
    const matches = context.readFromPort<MatchResult>('matches');
    const diff = createDiff(config, source, target, matches);
    const { data, numMatched, numMerged } = merge(
      matches,
      source,
      target,
      config
    );
    context.writeToPort('data', data);
    context.writeToPort('diff', diff);
    return `Matched ${numMatched} and merged ${numMerged} items`;
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
  source: SourceItem[],
  target: object[],
  config: MergeConfig
) {
  const mappings = createBestMatchMappings(matches);
  let numMatched = 0;
  let numMerged = 0;
  // Map all entries in the match table to the merge result
  const data = mappings
    .map((targetIndices, sourceIndex) => {
      if (targetIndices.length === 0) {
        return config.dropUnmatched ? null : source[sourceIndex];
      }
      const targetIndicesToMerge = config.mergeMultiple
        ? targetIndices
        : targetIndices.slice(0, 1);
      source[sourceIndex].$numMatched = targetIndices.length;
      numMatched += targetIndices.length;
      source[sourceIndex].$numMerged = 0;
      const mergedItem = targetIndicesToMerge.reduce(
        (itemBeingMerged, targetIndex) => {
          itemBeingMerged.$numMerged! += 1;
          numMerged += 1;
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
        source[sourceIndex]
      );
      _.set(mergedItem, '$matches', matches[sourceIndex]);
      return mergedItem;
    })
    // Get rid of items that couldn't be matched
    // Doing it after the mapping to preserve the indices
    .filter(mergedItem => mergedItem !== null) as SourceItem[];
  return { data, numMatched, numMerged };
}

export function createDiff(
  config: MergeConfig,
  source: object[],
  target: object[],
  matches: MatchResult
) {
  const diffs = _.flatten(
    createBestMatchMappings(matches)
      .map((targetIndices, sourceIndex) =>
        targetIndices.map(targetIndex =>
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
