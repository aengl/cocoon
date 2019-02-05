import { NodeObject } from '../../../common/node';

export interface FilterRowsViewState {
  selectedRows?: number[] | null;
}

export const FilterRows: NodeObject<any, FilterRowsViewState> = {
  category: 'Filter',

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

  async process(context) {
    const { viewState } = context.node.definition;
    const data = context.readFromPort<object[]>('data');
    if (viewState !== undefined && viewState.selectedRows) {
      const selectedData = viewState.selectedRows
        .map(i => data[i])
        .filter(x => x !== undefined);
      context.writeToPort('data', selectedData);
      return `Filtered out ${data.length - selectedData.length} items`;
    } else {
      context.writeToPort('data', data);
      return `No filter applied`;
    }
  },
};
