import { CocoonNode } from '@cocoon/types';
import _ from 'lodash';

interface Ports {
  attribute: string;
  data: Record<string, string>[];
  values: string[];
}

export const FilterMatches: CocoonNode<Ports> = {
  category: 'Filter',
  description: `Filters a collection my matching attribute values against a set.`,

  in: {
    attribute: {
      required: true,
      visible: false,
    },
    data: {
      required: true,
    },
    values: {
      required: true,
      visible: false,
    },
  },

  out: {
    data: {},
  },

  defaultPort: {
    incoming: true,
    name: 'data',
  },

  async *process(context) {
    const { attribute, data, values } = context.ports.read();
    const set = new Set(values);
    const filteredData = data.filter(item => set.has(_.get(item, attribute)));
    context.ports.write({ data: filteredData });
    return `Filtered out ${data.length - filteredData.length} items`;
  },
};
