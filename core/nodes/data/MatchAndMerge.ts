import { NodeObject } from '../../../common/node';
import { findUnmatched, match, MatchConfig } from './Match';
import { createDiff, merge, MergeConfig } from './Merge';

export interface IMatchAndMergeConfig extends MatchConfig, MergeConfig {}

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
    unmatched: {},
  },

  async process(context) {
    const source = context.readFromPort<object[]>('source');
    const target = context.readFromPort<object[]>('target');
    const config = context.readFromPort<IMatchAndMergeConfig>('config');
    const matches = match(source, target, config, context.progress);
    const diff = createDiff(config, source, target, matches);
    const { data, numMatched, numMerged } = merge(
      matches,
      source,
      target,
      config
    );
    context.writeToPort('data', data);
    context.writeToPort('matches', matches);
    context.writeToPort('diff', diff);
    context.writeToPort('unmatched', findUnmatched(source, matches));
    return `Matched ${numMatched} and merged ${numMerged} items`;
  },
};

export { MatchAndMerge };
