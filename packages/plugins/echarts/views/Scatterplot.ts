import {
  CocoonView,
  CocoonViewProps,
  ViewStateWithRangeSelection,
  ViewStateWithRowSelection,
} from '@cocoon/types';
import _ from 'lodash';
import { listDimensions } from '../util';

export interface ScatterplotData {
  colorDimension?: string;
  data: object[];
  dimensions: string[];
  sizeDimension?: string;
  xDimension: string;
  yDimension: string;
}

export interface ScatterplotViewState
  extends ViewStateWithRangeSelection,
    ViewStateWithRowSelection {
  color?: string;
  id?: string;
  sample?: number;
  size?: string;
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
    const dimensions = listDimensions(data, _.isNumber);
    const xDimension = state.x || dimensions[0];
    const yDimension = state.y || dimensions[1];
    const id = state.id || dimensions[0];
    if (xDimension === undefined || yDimension === undefined) {
      throw new Error(`no suitable axis dimensions found`);
    }
    return {
      colorDimension: state.color,
      data: data.map(d => [
        d[xDimension],
        d[yDimension],
        d[state.size!],
        d[state.color!],
        d[id],
      ]),
      dimensions,
      sizeDimension: state.size,
      xDimension,
      yDimension,
    };
  },

  respondToQuery: (context, data: object[], query) => data[query],
};
