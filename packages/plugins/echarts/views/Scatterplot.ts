import {
  CocoonView,
  CocoonViewProps,
  ViewStateWithRangeSelection,
  ViewStateWithRowSelection,
} from '@cocoon/types';
import serialiseDataForView, {
  DimensionInfo,
} from '@cocoon/util/serialiseDataForView';
import _ from 'lodash';
import { listDimensions } from '../util';

export interface ScatterplotData {
  availableDimensions: string[];
  data: object[];
  dimensions: {
    color?: DimensionInfo;
    id?: DimensionInfo;
    size?: DimensionInfo;
    x: DimensionInfo;
    y: DimensionInfo;
    [name: string]: DimensionInfo | undefined;
  };
}

export interface ScatterplotViewState
  extends ViewStateWithRangeSelection,
    ViewStateWithRowSelection {
  color?: string;
  id?: string;
  sample?: number;
  size?: string;
  tooltips?: string | string[];
  x?: string;
  y?: string;
}

export type ScatterplotQuery = number;
export type ScatterplotQueryResponse = object;
export type ScatterplotProps = CocoonViewProps<
  ScatterplotData,
  ScatterplotViewState,
  ScatterplotQuery,
  ScatterplotQueryResponse
>;

export const Scatterplot: CocoonView<
  ScatterplotData,
  ScatterplotViewState,
  ScatterplotQuery,
  ScatterplotQueryResponse
> = {
  serialiseViewData: async (context, data: object[], state) => {
    if (data.length === 0) {
      return null;
    }
    const availableDimensions = listDimensions(data, _.isNumber);
    const { data: serialisedData, dimensions } = serialiseDataForView(
      data,
      {
        x: state.x || availableDimensions[0],
        y: state.y || availableDimensions[1],
        // tslint:disable-next-line:object-literal-sort-keys
        size: state.size,
        color: state.color,
        id: {
          attribute: state.id,
          map: shorten,
        },
      },
      _.castArray(state.tooltips)
    );
    if (!dimensions.x || !dimensions.y) {
      throw new Error(`no suitable axis dimensions found`);
    }
    return {
      availableDimensions,
      data: serialisedData,
      dimensions: dimensions as ScatterplotData['dimensions'],
    };
  },

  respondToQuery: (context, data: object[], query) => data[query],
};

const shorten = (x: unknown) =>
  _.isString(x) && x.length > 42 ? `${x.slice(0, 36)}...` : x;
