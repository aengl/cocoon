import { NodeObject } from '../../../common/node';

export type FilterFunction = (item: object) => boolean;

const FilterCustom: NodeObject = {
  in: {
    data: {
      required: true,
    },
    filter: {},
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
    const filterList = context.readFromPort<FilterFunction[]>('filter');

    let selectedData = data;
    for (const filter of filterList) {
      selectedData = selectedData.filter(item => Boolean(filter(item)));
    }
    context.writeToPort('data', selectedData);
    return `Filtered out ${data.length - selectedData.length} items`;
  },
};

export { FilterCustom };
