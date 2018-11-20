import _ from 'lodash';
import { NodeObject } from '../../../common/node';

export interface FilterRowsViewState {
  selectedRows?: number[];
}

const FilterRows: NodeObject = {
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

  process: async context => {
    const { viewState } = context.node.state;
    const data = context.readFromPort<object[]>('data');
    if (!_.isNil(viewState) && viewState.selectedRows !== undefined) {
      const selectedData = viewState.selectedRows.map(i => data[i]);
      context.writeToPort('data', selectedData);
    } else {
      context.writeToPort('data', data);
    }
  },
};

export { FilterRows };
