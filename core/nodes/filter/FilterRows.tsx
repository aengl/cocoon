import _ from 'lodash';
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
    const { view } = context.node.state;
    const data = context.readFromPort<object[]>('data');
    if (!_.isNil(view) && view.selectedRows !== undefined) {
      const selectedData = view.selectedRows.map(i => data[i]);
      context.writeToPort('data', selectedData);
    } else {
      context.writeToPort('data', data);
    }
  },
};

export { FilterRows };
