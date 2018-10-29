import _ from 'lodash';
import { ICocoonNode } from '..';

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
    const data = context.readFromPort<object[]>('data');
    context.writeToPort<object[]>(
      'data',
      data.map(item => context.config.attributes.map(a => _.get(item, a)))
    );
    return `converted ${data.length} item(s)`;
  },
};

export { ObjectToArray };
