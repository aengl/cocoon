import { ICocoonNode } from '..';
import { IMatchConfig, match } from './Match';
import { createDiff, IMergeConfig, merge, Merge } from './Merge';

export interface IMatchAndMergeConfig extends IMatchConfig, IMergeConfig {}

/**
 * Matches and merges two collections.
 */
const MatchAndMerge: ICocoonNode = {
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
    const source = context.readFromPort<object[]>('source');
    const target = context.readFromPort<object[]>('target');
    const config = context.readFromPort<IMatchAndMergeConfig>('config');
    const matches = match(source, target, config, context.progress);
    const data = merge(matches, source, target, config);
    context.writeToPort('data', data);
    context.writeToPort('matches', matches);
    return {
      diff: createDiff(config, source, target, matches),
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
