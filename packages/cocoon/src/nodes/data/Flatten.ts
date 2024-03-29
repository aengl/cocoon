import { CocoonNode } from '@cocoon/types';
import _ from 'lodash';

export interface Ports {
  attribute: string;
  data: Record<string, unknown>[];
}

export const Flatten: CocoonNode<Ports> = {
  category: 'Data',
  description: 'Merges nested objects into the data item.',

  in: {
    attribute: {
      required: true,
      visible: false,
    },
    data: {
      required: true,
    },
  },

  out: {
    data: {},
  },

  async *process(context) {
    const { attribute, data } = context.ports.read();
    const flatData = data.map(item =>
      attribute in item
        ? _.assign(_.omit(item, attribute), item[attribute])
        : item
    );
    context.ports.write({ data: flatData });
    return `Flattened ${data.length} items`;
  },
};
