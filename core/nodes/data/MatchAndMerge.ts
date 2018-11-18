import { NodeObject } from '..';
import { IMatchConfig, match } from './Match';
import { createDiff, merge, MergeConfig } from './Merge';

export interface IMatchAndMergeConfig extends IMatchConfig, MergeConfig {}

/**
 * Matches and merges two collections.
 */
const MatchAndMerge: NodeObject = {
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
    diff: {},
    matches: {},
  },

  process: async context => {
    const source = context.readFromPort<object[]>('source');
    const target = context.readFromPort<object[]>('target');
    const config = context.readFromPort<IMatchAndMergeConfig>('config');
    const matches = match(source, target, config, context.progress);
    context.writeToPort('data', merge(matches, source, target, config));
    context.writeToPort('matches', matches);
    context.writeToPort('diff', createDiff(config, source, target, matches));
  },
};

export { MatchAndMerge };
