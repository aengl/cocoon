import { NodeObject } from '../../../common/node';

interface Ports {
  data: object[];
}

export interface ViewState {
  selectedRows?: number[] | null;
}

export const FilterRows: NodeObject<Ports, any, ViewState> = {
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
    const { data } = context.ports.read();
    if (viewState !== undefined && viewState.selectedRows) {
      const selectedData = viewState.selectedRows
        .map(i => data[i])
        .filter(x => x !== undefined);
      context.ports.write({ data: selectedData });
      return `Filtered out ${data.length - selectedData.length} items`;
    } else {
      context.ports.write({ data });
      return `No filter applied`;
    }
  },
};
