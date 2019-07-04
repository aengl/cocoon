import { CocoonNode } from '@cocoon/types';
import castFunction from '@cocoon/util/castFunction';
import _ from 'lodash';

export interface Ports {
  data: object[];
  f: any;
}

export const Filter: CocoonNode<Ports> = {
  category: 'Filter',
  description: `Applies a filter function to a collection.`,

  in: {
    data: {
      required: true,
    },
    f: {
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
    const { data, f: filter } = context.ports.read();

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
    castFunction<(...args: any[]) => boolean>(x)
  );
  const filterFunc = invert ? x => !Boolean(x) : x => Boolean(x);
  let filteredData = data;
  for (const f of filterList) {
    filteredData = filteredData.filter((...args) => filterFunc(f(...args)));
  }
  return filteredData;
}
