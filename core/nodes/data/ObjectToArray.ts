import _ from 'lodash';
import { NodeObject } from '../../../common/node';

export interface Ports {
  attributes: string[];
  data: object[];
}

export const ObjectToArray: NodeObject<Ports> = {
  category: 'Data',

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
