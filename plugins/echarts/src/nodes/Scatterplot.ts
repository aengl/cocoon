import {
  CocoonView,
  CocoonViewProps,
  FilterRangesViewState,
  FilterRowsViewState,
} from 'cocoon-node';
import _ from 'lodash';
import { listDimensions } from '../data';

export interface ScatterplotData {
  colorDimension?: string;
  data: object[];
  dimensions: string[];
  sizeDimension?: string;
  xDimension: string;
  yDimension: string;
}

export interface ScatterplotViewState
  extends FilterRowsViewState,
    FilterRangesViewState {
  colorDimension?: string;
  idDimension?: string;
  sizeDimension?: string;
  xDimension?: string;
  yDimension?: string;
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
    const xDimension = state.xDimension || dimensions[0];
    const yDimension = state.yDimension || dimensions[1];
    const id = state.idDimension || dimensions[0];
    if (xDimension === undefined || yDimension === undefined) {
      throw new Error(`no suitable axis dimensions found`);
    }
    return {
      colorDimension: state.colorDimension,
      data: data.map(d => [
        d[xDimension],
        d[yDimension],
        d[state.sizeDimension!],
        d[state.colorDimension!],
        d[id],
      ]),
      dimensions,
      sizeDimension: state.sizeDimension,
      xDimension,
      yDimension,
    };
  },

  respondToQuery: (context, data: object[], query) => data[query],
};
