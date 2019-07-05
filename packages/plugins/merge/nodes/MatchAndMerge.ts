import { CocoonNode } from '@cocoon/types';
import { match, MatchConfig } from './Match';
import {
  createDiff,
  getUnmatchedSource,
  getUnmatchedTarget,
  merge,
  MergeConfig,
} from './Merge';

export type MatchAndMergeConfig = MatchConfig & MergeConfig;

export interface Ports {
  config: MatchAndMergeConfig;
  source: object[];
  target: object[];
}

export const MatchAndMerge: CocoonNode<Ports> = {
  category: 'Data',
  description: `Matches and merges two collections.`,

  in: {
    config: {
      hide: true,
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

  async *process(context) {
    const { config, source, target } = context.ports.read();
    const matches = match(source, target, config);
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
