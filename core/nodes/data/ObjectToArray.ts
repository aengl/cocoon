import _ from 'lodash';
import { NodeObject } from '../../../common/node';

export const ObjectToArray: NodeObject = {
  category: 'Data',

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
    const data = context.ports.read<object[]>('data');
    const attributes = context.ports.read<string[]>('attributes');
    context.ports.writeAll({
      data: data.map(item => attributes.map(a => _.get(item, a))),
    });
    return `Converted ${data.length} items`;
  },
};
