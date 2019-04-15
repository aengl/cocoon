import { NodeObject } from '../../../common/node';
import { match, MatchConfig } from './Match';
import {
  createDiff,
  merge,
  MergeConfig,
  getUnmatchedSource,
  getUnmatchedTarget,
} from './Merge';

export type MatchAndMergeConfig = MatchConfig & MergeConfig;

/**
 * Matches and merges two collections.
 */
export const MatchAndMerge: NodeObject = {
  category: 'Data',

  in: {
    source: {
      required: true,
    },
    target: {
      required: true,
    },
  },

  out: {
    data: {},
    debug: {},
    diff: {},
    unmatchedSource: {},
    unmatchedTarget: {},
  },

  async process(context) {
    const source = context.ports.read<object[]>('source');
    const target = context.ports.read<object[]>('target');
    const config = context.ports.read<MatchAndMergeConfig>('config');
    const matches = match(source, target, config, context.progress);
    const data = merge(matches, source, target, config);
    context.ports.writeAll({
      data,
      debug: () => ({
        matches,
      }),
      diff: () => createDiff(config, source, target, matches),
      unmatchedSource: () => getUnmatchedSource(source, matches),
      unmatchedTarget: () => getUnmatchedTarget(target, matches),
    });
    return `Matched ${matches.length} items in source`;
  },
};
