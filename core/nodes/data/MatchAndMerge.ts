import { ICocoonNode, readFromPort, writeToPort } from '..';
import { IMatchConfig, match } from './Match';
import { IMergeConfig, merge } from './Merge';

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
    const { config, node } = context;
    const source = readFromPort(node, 'source') as object[];
    const target = readFromPort(node, 'target') as object[];
    const matches = match(source, target, config, context.progress);
    const data = merge(matches, source, target, config);
    writeToPort(node, 'data', data);
    writeToPort(node, 'matches', matches);
    return `merged ${data.length} row(s)`;
  },
};

export { MatchAndMerge };
