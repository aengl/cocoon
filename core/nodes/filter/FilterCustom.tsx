import _ from 'lodash';
import { castFunction } from '../../../common/cast';
import { NodeObject } from '../../../common/node';

export type FilterFunction = (item: object) => boolean;

export const FilterCustom: NodeObject = {
  category: 'Filter',

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
    const data = context.ports.read<object[]>('data');
    const filter = context.ports.read<any>('filter');

    if (filter) {
      const filterList = _.castArray(filter).map(x =>
        castFunction<FilterFunction>(x)
      );

      let selectedData = data;
      for (const f of filterList) {
        selectedData = selectedData.filter(item => Boolean(f(item)));
      }
      context.ports.writeAll({ data: selectedData });
      return `Filtered out ${data.length - selectedData.length} items`;
    }

    context.ports.writeAll({ data });
    return `No filter applied`;
  },
};
