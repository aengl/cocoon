import _ from 'lodash';
import { NodeObject } from '../../../common/node';

export interface FilterRangesViewState {
  selectedRanges?: {
    [dimension: string]: [number, number];
  } | null;
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

  async process(context) {
    const { viewState } = context.node;
    const data = context.readFromPort<object[]>('data');
    if (viewState !== undefined && viewState.selectedRanges) {
      const dimensions = Object.keys(viewState.selectedRanges);
      const selectedData = data.filter(
        item =>
          !dimensions.some(dimension => {
            const value = item[dimension];
            const range = viewState.selectedRanges![dimension];
            return _.isNil(value) || value < range[0] || value > range[1];
          })
      );
      context.writeToPort('data', selectedData);
      return `Filtered out ${data.length - selectedData.length} items`;
    } else {
      context.writeToPort('data', data);
      return `No filter applied`;
    }
  },
};

export { FilterRanges };
