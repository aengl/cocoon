import _ from 'lodash';
import { castFunction } from '../../../common/cast';
import { CocoonNode } from '../../../common/node';

export type FilterFunction = (item: object) => boolean;

export interface Ports {
  data: object[];
  filter: any;
}

export const FilterCustom: CocoonNode<Ports> = {
  category: 'Filter',
  description: `Applies a filter function to a collection.`,

  in: {
    data: {
      required: true,
    },
    filter: {
      hide: true,
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
    const { data, filter } = context.ports.read();

    if (filter) {
      const filterList = _.castArray(filter).map(x =>
        castFunction<FilterFunction>(x)
      );

      let selectedData = data;
      for (const f of filterList) {
        selectedData = selectedData.filter(item => Boolean(f(item)));
      }
      context.ports.write({ data: selectedData });
      return `Filtered out ${data.length - selectedData.length} items`;
    }

    context.ports.write({ data });
    return `No filter applied`;
  },
};
