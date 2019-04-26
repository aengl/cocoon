import _ from 'lodash';
import { CocoonNode } from '../../../common/node';

export interface Ports {
  attributes: string[];
  data: object[];
}

export const ObjectToArray: CocoonNode<Ports> = {
  category: 'Data',
  description: `Transforms data objects into an array of values by extracting a set of attributes.`,

  in: {
    attributes: {
      hide: true,
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
    const { attributes, data } = context.ports.read();
    context.ports.write({
      data: data.map(item => attributes.map(a => _.get(item, a))),
    });
    return `Converted ${data.length} items`;
  },
};
