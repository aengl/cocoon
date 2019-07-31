import {
  CocoonView,
  CocoonViewProps,
  ViewStateWithRangeSelection,
  ViewStateWithRowSelection,
} from '@cocoon/types';
import listDataAttributes from '@cocoon/util/listDataAttributes';
import serialiseDataForView, {
  DimensionInfo,
} from '@cocoon/util/serialiseDataForView';
import _ from 'lodash';

export interface Data {
  availableDimensions: string[];
  data: any[][];
  dimensions: {
    color?: DimensionInfo;
    id?: DimensionInfo;
    index: DimensionInfo;
    size?: DimensionInfo;
    x: DimensionInfo;
    y: DimensionInfo;
    [name: string]: DimensionInfo | undefined;
  };
}

export interface ViewState
  extends ViewStateWithRangeSelection,
    ViewStateWithRowSelection {
  color?: string;
  id?: string;
  iqr?: boolean;
  sample?: number;
  size?: string;
  tooltip?: string | string[];
  x?: string;
  y?: string;
}

export type Query = number;
export type QueryResponse = object;
export type Props = CocoonViewProps<Data, ViewState, Query, QueryResponse>;

export const Scatterplot: CocoonView<Data, ViewState, Query, QueryResponse> = {
  description: `Plots data in a [Scatter plot](https://en.wikipedia.org/wiki/Scatter_plot).`,
  stateDescriptions: {
    color: `Attribute name of the color dimension.`,
    id: `Attribute name of the id dimension, used to identify a data point in the tooltip.`,
    iqr: `If true, the "color" and "size" dimensions visually map across the interquartile range, instead of min/max.`,
    sample: `Samples n random data points.`,
    selectedRanges: `Filtered attribute value ranges.`,
    selectedRows: `Filtered row indices.`,
    size: `Attribute name for the size dimension.`,
    tooltip: `Attribute name for the size dimension.`,
    x: `Attribute name for the X dimension.`,
    y: `Attribute name for the Y dimension.`,
  },

  serialiseViewData: async (context, data: object[], state) => {
    if (data.length === 0) {
      return null;
    }
    const availableDimensions = listDataAttributes(data, _.isNumber);
    const { data: serialisedData, dimensions } = serialiseDataForView(
      data,
      {
        x: state.x || availableDimensions[0],
        y: state.y || availableDimensions[1],
        // tslint:disable-next-line:object-literal-sort-keys
        size: state.size,
        color: state.color,
        index: (d, i) => i,
        id: state.id
          ? {
              attribute: state.id,
            }
          : null,
      },
      _.castArray(state.tooltip)
    );
    if (!dimensions.x || !dimensions.y) {
      throw new Error(`no suitable axis dimensions found`);
    }
    const maxDataSize = state.sample ? state.sample : data.length;
    return {
      availableDimensions,
      data:
        data.length > maxDataSize
          ? _.sampleSize(serialisedData, maxDataSize)
          : serialisedData,
      dimensions: dimensions as Data['dimensions'],
    };
  },

  respondToQuery: (context, data: object[], query) => data[query],
};
