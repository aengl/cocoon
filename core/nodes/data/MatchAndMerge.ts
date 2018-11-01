import { ICocoonNode } from '..';
import { IMatchConfig, match } from './Match';
import { createDiff, IMergeConfig, merge, Merge } from './Merge';

export interface IMatchAndMergeConfig extends IMatchConfig, IMergeConfig {}

/**
 * Matches and merges two collections.
 */
const MatchAndMerge: ICocoonNode<IMatchAndMergeConfig> = {
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
    matches: {},
  },

  process: async context => {
    const { config } = context;
    const source = context.readFromPort<object[]>('source');
    const target = context.readFromPort<object[]>('target');
    const matches = match(source, target, config, context.progress);
    const data = merge(matches, source, target, config);
    context.writeToPort('data', data);
    context.writeToPort('matches', matches);
    return {
      diff: createDiff(source, target, matches),
    };
  },

  renderView: context => Merge.renderView!(context),

  respondToQuery: (context, query) => {
    const source = context.readFromPort<object[]>('source');
    const target = context.readFromPort<object[]>('target');
    return {
      sourceItem: source[query],
      targetItem: target[query],
    };
  },
};

export { MatchAndMerge };
