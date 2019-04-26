import _ from 'lodash';
import { CocoonNode } from '../../../common/node';

export interface Ports {
  attribute: string;
  data: object[];
}

export const Flatten: CocoonNode<Ports> = {
  category: 'Data',
  description: 'Merges nested objects into the data item.',

  in: {
    attribute: {
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
    const { attribute, data } = context.ports.read();
    const flatData = data.map(item =>
      item[attribute]
        ? _.assign(_.omit(item, attribute), item[attribute])
        : item
    );
    context.ports.write({ data: flatData });
    return `Flattened ${data.length} items`;
  },
};
