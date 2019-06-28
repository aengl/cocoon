import { CocoonNode, ViewStateWithRangeSelection } from '@cocoon/types';
import _ from 'lodash';

interface Ports {
  data: object[];
}

export const FilterRanges: CocoonNode<
  Ports,
  any,
  ViewStateWithRangeSelection
> = {
  category: 'Filter',
  description: `Filters a collection by requiring values for one or more attributes to be in a specified range.`,

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
    const { viewState } = context.graphNode.definition;
    const { data } = context.ports.read();
    if (viewState !== undefined && viewState.selectedRanges) {
      const dimensions = Object.keys(viewState.selectedRanges);
      const selectedData = data.filter(
        item =>
          !dimensions.some(dimension => {
            const value = item[dimension];
            const range = viewState.selectedRanges![dimension];
            return _.isNil(value) || !valueInRange(value, range);
          })
      );
      context.ports.write({ data: selectedData });
      return `Filtered out ${data.length - selectedData.length} items`;
    } else {
      context.ports.write({ data });
      return `No filter applied`;
    }
  },
};

function valueInRange(value: any, range: number[]) {
  if (_.isNumber(range)) {
    return value === range;
  }
  return value >= range[0] && value <= range[1];
}
