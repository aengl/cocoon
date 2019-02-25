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
    const data = context.ports.read<object[]>('data');
    const filterList = _.castArray(context.ports.read<any>('filter')).map(x =>
      castFunction<FilterFunction>(x)
    );

    let selectedData = data;
    for (const filter of filterList) {
      selectedData = selectedData.filter(item => Boolean(filter(item)));
    }
    context.ports.writeAll({ data: selectedData });
    return `Filtered out ${data.length - selectedData.length} items`;
  },
};
