import _ from 'lodash';
import { NodeObject } from '..';

const ObjectToArray: NodeObject = {
  in: {
    attributes: {
      required: true,
    },
    data: {
      required: true,
    },
  },

  out: {
    data: {},
  },

  process: async context => {
    const data = context.readFromPort<object[]>('data');
    const attributes = context.readFromPort<string[]>('attributes');
    context.writeToPort<object[]>(
      'data',
      data.map(item => attributes.map(a => _.get(item, a)))
    );
    return `converted ${data.length} item(s)`;
  },
};

export { ObjectToArray };
