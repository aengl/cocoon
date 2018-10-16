import _ from 'lodash';
import { ICocoonNode, readInputPort, writeOutput } from '..';
import { Context } from '../../context';

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

  process: async (config: IObjectToArrayConfig, context: Context) => {
    const data = readInputPort(context.node, 'data') as object[];
    writeOutput(
      context.node,
      'data',
      data.map(item => config.attributes.map(a => _.get(item, a)))
    );
    return `converted ${data.length} item(s)`;
  },
};

module.exports = { ObjectToArray };
