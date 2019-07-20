import { CocoonView, CocoonViewProps } from '@cocoon/types';
import listDataAttributes from '@cocoon/util/listDataAttributes';
import _ from 'lodash';

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
    const dimensions = _.sortBy(listDataAttributes(data));
    return {
      data,
      dimensions,
      id: state.idDimension || dimensions[0],
    };
  },

  respondToQuery: (context, data: object[], query) => data[query],
};
