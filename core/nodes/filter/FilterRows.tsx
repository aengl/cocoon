import { NodeObject } from '../../../common/node';

export interface FilterRowsViewState {
  selectedRows?: number[];
}

const FilterRows: NodeObject<any, FilterRowsViewState> = {
  in: {
    data: {
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

  supportedViewStates: ['selectedRows'],

  process: async context => {
    const { viewState } = context.node;
    const data = context.readFromPort<object[]>('data');
    if (viewState !== undefined && viewState.selectedRows !== undefined) {
      const selectedData = viewState.selectedRows.map(i => data[i]);
      context.writeToPort('data', selectedData);
      return `Filtered out ${data.length - selectedData.length} items`;
    } else {
      context.writeToPort('data', data);
      return `No filter applied`;
    }
  },
};

export { FilterRows };
