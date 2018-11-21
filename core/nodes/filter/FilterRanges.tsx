import _ from 'lodash';
import { NodeObject } from '../../../common/node';

export interface FilterRangesViewState {
  selectedRanges?: {
    [dimension: string]: [number, number];
  };
}

const FilterRanges: NodeObject<any, FilterRangesViewState> = {
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

  supportedViewStates: ['selectedRanges'],

  process: async context => {
    const { view } = context.node.state;
    const data = context.readFromPort<object[]>('data');
    if (!_.isNil(view) && view.selectedRanges !== undefined) {
      const dimensions = Object.keys(view.selectedRanges);
      context.writeToPort(
        'data',
        data.filter(
          item =>
            !dimensions.some(dimension => {
              const value = item[dimension];
              const range = view.selectedRanges![dimension];
              return _.isNil(value) || value < range[0] || value > range[1];
            })
        )
      );
    } else {
      context.writeToPort('data', data);
    }
  },
};

export { FilterRanges };
