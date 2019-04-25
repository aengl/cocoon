import { NodeObject } from '../../../common/node';
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
  config: string | MatchAndMergeConfig;
  source: object[];
  target: object[];
}

export const MatchAndMerge: NodeObject<Ports> = {
  category: 'Data',
  description: `Matches and merges two collections.`,

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
    const resolvedConfig = await context.uri.resolveYaml<MatchAndMergeConfig>(
      config,
      { root: context.definitions.root }
    );
    const matches = match(source, target, resolvedConfig, context.progress);
    const data = merge(matches, source, target, resolvedConfig);
    context.ports.write({
      data,
      debug: () => ({
        matches,
      }),
      diff: () => createDiff(resolvedConfig, source, target, matches),
      unmatchedSource: () => getUnmatchedSource(source, matches),
      unmatchedTarget: () => getUnmatchedTarget(target, matches),
    });
    return `Matched ${matches.length} items in source`;
  },
};
