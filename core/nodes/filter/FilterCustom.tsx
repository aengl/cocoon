import _ from 'lodash';
import { NodeObject } from '../../../common/node';

export type FilterFunction = (item: object) => boolean;
export type FilterDefinition =
  | string
  | string[]
  | FilterFunction
  | FilterFunction[];

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
    const data = context.readFromPort<object[]>('data');
    const filterList = _.castArray<string | FilterFunction>(
      context.readFromPort<FilterDefinition>('filter')
    );

    let selectedData = data;
    for (const filter of filterList) {
      // tslint:disable-next-line no-eval
      const f = _.isString(filter) ? eval(filter) : filter;
      selectedData = selectedData.filter(item => Boolean(f(item)));
    }
    context.writeToPort('data', selectedData);
    return `Filtered out ${data.length - selectedData.length} items`;
  },
};
