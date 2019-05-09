import { CocoonView, CocoonViewProps } from 'cocoon-node';
import _ from 'lodash';
import { listDimensions } from '../util';

export interface TableData {
  data: object[];
  dimensions: string[];
  id: string;
}

export interface TableState {
  idDimension?: string;
}

export type TableQuery = number;
export type TableQueryResponse = object;
export type TableProps = CocoonViewProps<
  TableData,
  TableState,
  TableQuery,
  TableQueryResponse
>;

export const Table: CocoonView<
  TableData,
  TableState,
  TableQuery,
  TableQueryResponse
> = {
  serialiseViewData: async (context, data: object[], state) => {
    if (data.length === 0) {
      return null;
    }
    const dimensions = _.sortBy(listDimensions(data));
    return {
      data,
      dimensions,
      id: state.idDimension || dimensions[0],
    };
  },

  respondToQuery: (context, data: object[], query) => data[query],
};
