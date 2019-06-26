import { castFunction } from '@cocoon/shared/cast';
import { CocoonNode } from '@cocoon/types';
import _ from 'lodash';

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
    filtered: {},
  },

  defaultPort: {
    incoming: true,
    name: 'data',
  },

  async process(context) {
    const { data, filter } = context.ports.read();

    if (filter) {
      const filteredData = applyFilter(data, filter, false);
      context.ports.write({
        data: filteredData,
        filtered: applyFilter(data, filter, true),
      });
      return `Filtered out ${data.length - filteredData.length} items`;
    }

    context.ports.write({
      data,
      filtered: [],
    });
    return `No filter applied`;
  },
};

function applyFilter(data: object[], filter: any, invert = false) {
  const filterList = _.castArray(filter).map(x =>
    castFunction<FilterFunction>(x)
  );
  const filterFunc = invert ? x => !Boolean(x) : x => Boolean(x);

  let filteredData = data;
  for (const f of filterList) {
    filteredData = filteredData.filter(item => filterFunc(f(item)));
  }
  return filteredData;
}
