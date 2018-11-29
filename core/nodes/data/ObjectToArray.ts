import _ from 'lodash';
import { NodeObject } from '../../../common/node';

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

  async process(context) {
    const data = context.readFromPort<object[]>('data');
    const attributes = context.readFromPort<string[]>('attributes');
    context.writeToPort<object[]>(
      'data',
      data.map(item => attributes.map(a => _.get(item, a)))
    );
    return `converted ${data.length} items`;
  },
};

export { ObjectToArray };
