import _ from 'lodash';
import { CocoonNode } from '../../../common/node';

interface Ports {
  attribute: string;
  data: object[];
  values: string[];
}

export const FilterMatches: CocoonNode<Ports> = {
  category: 'Filter',
  description: `Filters a collection my matching attribute values against a set.`,

  in: {
    attribute: {
      hide: true,
      required: true,
    },
    data: {
      required: true,
    },
    values: {
      hide: true,
      required: true,
    },
  },

  out: {
    data: {},
  },

  defaultPort: {
    incoming: true,
    name: 'data',
  },

  async process(context) {
    const { attribute, data, values } = context.ports.read();
    const set = new Set(values);
    const filteredData = data.filter(item => set.has(_.get(item, attribute)));
    context.ports.write({ data: filteredData });
    return `Filtered out ${data.length - filteredData.length} items`;
  },
};
