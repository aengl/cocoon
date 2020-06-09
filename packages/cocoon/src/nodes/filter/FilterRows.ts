import { CocoonNode, ViewStateWithRowSelection } from '@cocoon/types';

interface Ports {
  data: Record<string, unknown>[];
}

export const FilterRows: CocoonNode<Ports> = {
  category: 'Filter',
  description: `Filters a collection by defining a list of included rows by index.`,

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

  async *process(context) {
    const { data } = context.ports.read();
    const viewState: ViewStateWithRowSelection =
      context.graphNode.definition.viewState;
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
