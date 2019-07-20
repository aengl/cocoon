import {
  CocoonView,
  CocoonViewProps,
  ViewStateWithRangeSelection,
  ViewStateWithRowSelection,
} from '@cocoon/types';
import listDataAttributes from '@cocoon/util/listDataAttributes';
import * as d3 from 'd3-array';
import _ from 'lodash';
import castRegularExpression from '@cocoon/util/castRegularExpression';

export interface Data {
  histograms: Array<{
    attribute: string;
    bins: number[];
    max: number;
    min: number;
    values: number[];
  }>;
}

export interface ViewState
  extends ViewStateWithRangeSelection,
    ViewStateWithRowSelection {
  filter?: string | RegExp;
  thresholds?: number | number[];
}

export type Query = number;
export type QueryResponse = object;
export type Props = CocoonViewProps<Data, ViewState, Query, QueryResponse>;

export const Density: CocoonView<Data, ViewState, Query, QueryResponse> = {
  serialiseViewData: async (context, data: object[], state) => {
    if (data.length === 0) {
      return null;
    }

    const filter = state.filter ? castRegularExpression(state.filter) : null;
    const attributes = listDataAttributes(data, _.isNumber);
    const filteredAttributes = filter
      ? attributes.filter(x => x.match(filter))
      : attributes;
    const bin = (d3 as any).bin().thresholds(state.thresholds || 200);
    return {
      histograms: filteredAttributes.map(attribute => {
        const values = data.map(x => x[attribute]);
        const hist = bin(values);
        return {
          attribute,
          bins: hist.map(x => x.x0),
          max: _.max(values) || 1,
          min: _.min(values) || 0,
          values: hist.map(x => x.length),
        };
      }),
    };
  },

  respondToQuery: (context, data: object[], query) => data[query],
};
