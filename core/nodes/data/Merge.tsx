import * as _ from 'lodash';
import React from 'react';
import { ICocoonNode } from '..';
import { MatchResult } from '../../matchers';
import { createBestMatchMappings } from './Match';
import { MergeView } from './MergeView';

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

export interface IMergeDiff {
  id: string;

  sourceIndex: number;

  targetIndex: number;

  equal: Array<[string, any]>;

  different: Array<[string, any, any]>;

  numOnlyInSource: number;

  numOnlyInTarget: number;
}

export interface IMergeViewData {
  diff: IMergeDiff[];
}

export interface IMergeViewState {}

export type IMergeViewQuery = number;

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
const Merge: ICocoonNode<
  IMergeConfig,
  IMergeViewData,
  IMergeViewState,
  IMergeViewQuery
> = {
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
    const { config } = context;
    const source = context.readFromPort<object[]>('source');
    const target = context.readFromPort<object[]>('target');
    const matches = context.readFromPort<MatchResult>('matches');
    const data = merge(matches, source, target, config);
    context.writeToPort('data', data);
    return {
      diff: createDiff(config, source, target, matches),
    };
  },

  renderView: context => {
    return <MergeView context={context} />;
  },
};

export { Merge };

export function merge(
  matches: MatchResult,
  source: object[],
  target: object[],
  config: IMergeConfig
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
  config: IMergeConfig,
  source: object[],
  target: object[],
  matches: MatchResult
) {
  return _.sortBy(
    createBestMatchMappings(matches).map((targetIndex, sourceIndex) =>
      createDiffBetweenItems(
        config,
        sourceIndex,
        source[sourceIndex],
        targetIndex,
        target[targetIndex]
      )
    ),
    (itemDiff: IMergeDiff) => -itemDiff.different.length + itemDiff.equal.length
  );
}

function createDiffBetweenItems(
  config: IMergeConfig,
  sourceIndex: number,
  sourceItem: object,
  targetIndex: number,
  targetItem: object
): IMergeDiff {
  const diff: IMergeDiff = {
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
  if (targetIndex >= 0) {
    const keys = getKeySet(sourceItem, targetItem).filter(
      key =>
        // Filter metadata dimensions
        !key.startsWith('_') && !key.startsWith('$')
    );
    keys.forEach(key => {
      const a = sourceItem[key];
      const b = targetItem[key];
      if (!_.isNil(a) && _.isNil(b)) {
        diff.numOnlyInSource += 1;
      } else if (_.isNil(a) && !_.isNil(b)) {
        diff.numOnlyInTarget += 1;
      } else if (a === b) {
        diff.equal.push([key, a]);
      } else {
        diff.different.push([key, a, b]);
      }
    });
  }
  return diff;
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
  } else if (strategy === MergeStrategy.Overwrite) {
    return _.assign({}, sourceItem, targetItem);
  } else {
    return _.assign({}, targetItem, sourceItem);
  }
}
