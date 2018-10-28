import _ from 'lodash';
import { ICocoonNode, readFromPort, writeToPort } from '..';

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
    const data = readFromPort(context.node, 'data') as object[];
    writeToPort(
      context.node,
      'data',
      data.map(item => context.config.attributes.map(a => _.get(item, a)))
    );
    return `converted ${data.length} item(s)`;
  },
};

export { ObjectToArray };
