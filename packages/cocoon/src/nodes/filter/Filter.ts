import { CocoonNode } from '@cocoon/types';
import castFunction from '@cocoon/util/castFunction';
import _ from 'lodash';

export type FilterFunction = (...args: any[]) => boolean;

export interface Ports {
  data: object[];
  filter: string | string[] | FilterFunction | FilterFunction[];
}

export const Filter: CocoonNode<Ports> = {
  category: 'Filter',
  description: `Applies a filter function to a collection.`,

  in: {
    data: {
      description: `The data to filter.`,
      required: true,
    },
    filter: {
      description: `One or more filter functions that will be applied to each data item.`,
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

  async *process(context) {
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

function applyFilter(data: object[], filter: Ports['filter'], invert = false) {
  const filterList = _.castArray<any>(filter).map(x =>
    castFunction<FilterFunction>(x)
  );
  const filterFunc = invert ? x => !Boolean(x) : x => Boolean(x);
  let filteredData = data;
  for (const f of filterList) {
    filteredData = filteredData.filter((...args: any[]) =>
      filterFunc(f(...args))
    );
  }
  return filteredData;
}
