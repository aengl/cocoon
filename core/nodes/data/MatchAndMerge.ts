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

export interface Ports {
  config: MatchAndMergeConfig;
  source: object[];
  target: object[];
}

/**
 * Matches and merges two collections.
 */
export const MatchAndMerge: NodeObject<Ports> = {
  category: 'Data',

  in: {
    config: {
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
    debug: {},
    diff: {},
    unmatchedSource: {},
    unmatchedTarget: {},
  },

  async process(context) {
    const { config, source, target } = context.ports.read();
    const matches = match(source, target, config, context.progress);
    const data = merge(matches, source, target, config);
    context.ports.write({
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
