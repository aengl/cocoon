import * as _ from 'lodash';
import { ICocoonNode, readInputPort, writeOutput } from '..';
import { MatchResult } from '../../matchers';

/**
 * Determines how items are merged when they have one or more of the same keys,
 * but the values for those keys differ.
 */
enum MergeStrategy {
  /**
   * Overwrite the value in the source collection with the one in the target
   * collection.
   *
   * This is the default strategy.
   */
  Overwrite = 'overwrite',

  /**
   * Preserves the values in the source collection.
   */
  Preserve = 'preserve',

  /**
   * Preserves both values by turning them into an array.
   */
  Append = 'append',
}

export interface IMergeConfig {
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
}

/**
 * Merges two or more collections into one.
 */
const Merge: ICocoonNode<IMergeConfig> = {
  in: {
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
  },

  process: async context => {
    const { config, node } = context;
    const source = readInputPort(node, 'source') as object[];
    const target = readInputPort(node, 'target') as object[];
    const matches = readInputPort(node, 'matches') as MatchResult;
    const data = merge(matches, source, target, config);
    writeOutput(node, 'data', data);
    return `merged ${data.length} rows`;
  },
};

export { Merge };

export function merge(
  matches: MatchResult,
  source: object[],
  target: object[],
  config: IMergeConfig
) {
  // Create temporary index mapping array
  const mappings = matches.map(
    itemMatchResults =>
      // Find match with the maximum confidence and return its index
      itemMatchResults
        ? itemMatchResults.reduce(
            (best, m, i) => (m[0] && m[1] > best[1] ? [i, m[1]] : best),
            [-1, 0]
          )[0]
        : -1
  );
  // Debug: print mappings if the array is small enough
  // if (mappings.length <= 20) {
  //   debug(mappings);
  // }
  // Map all entries in the match table to the merge result
  const collection = mappings
    .map((targetIndex, sourceIndex) => {
      if (targetIndex === -1) {
        // targetIndex of -1 means that the item could not be matched
        return null;
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
    .filter(mergedItem => mergedItem !== null);
  return collection;
}

/**
 * Gets all keys that are either in the source or the target item, without
 * duplicates.
 */
function getKeySet(sourceItem: object, targetItem: object) {
  const keys = new Set(Object.keys(sourceItem));
  Object.keys(targetItem).forEach(key => keys.add(key));
  return [...keys];
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
 * Gets the result of merging two values using the `preserve` strategy.
 */
function preserve(sourceValue: any, targetValue: any) {
  return sourceValue === undefined ? targetValue : sourceValue;
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
  if (strategy === MergeStrategy.Append) {
    const keys = getKeySet(sourceItem, targetItem);
    return keys.reduce((merged: object, key) => {
      merged[key] = append(sourceItem[key], targetItem[key]);
      return merged;
    }, {});
  } else if (strategy === MergeStrategy.Preserve) {
    const keys = getKeySet(sourceItem, targetItem);
    return keys.reduce((merged: object, key) => {
      merged[key] = preserve(sourceItem[key], targetItem[key]);
      return merged;
    }, {});
  }
  return { ...sourceItem, ...targetItem };
}
