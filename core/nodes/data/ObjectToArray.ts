import _ from 'lodash';
import { ICocoonNode, readInputPort, writeOutput } from '..';

export interface IObjectToArrayConfig {
  attributes: string[];
}

const ObjectToArray: ICocoonNode<IObjectToArrayConfig> = {
  in: {
    data: {
      required: true,
    },
  },

  out: {
    data: {},
  },

  process: async context => {
    const data = readInputPort(context.node, 'data') as object[];
    writeOutput(
      context.node,
      'data',
      data.map(item => context.config.attributes.map(a => _.get(item, a)))
    );
    return `converted ${data.length} item(s)`;
  },
};

export { ObjectToArray };
