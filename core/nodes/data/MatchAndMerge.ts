import { ICocoonNode, readInputPort, writeOutput } from '..';
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
    const source = readInputPort(node, 'source') as object[];
    const target = readInputPort(node, 'target') as object[];
    const matches = match(source, target, config);
    const data = merge(matches, source, target, config);
    writeOutput(node, 'data', data);
    return `merged ${data.length} rows`;
  },
};

export { MatchAndMerge };
