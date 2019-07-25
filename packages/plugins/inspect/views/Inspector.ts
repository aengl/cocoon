import { CocoonView, CocoonViewProps } from '@cocoon/types';
import _ from 'lodash';

export type Data = string;

export interface ViewState {
  limit?: number;
  preview?: string | string[];
  expandLevel?: number;
  expandPaths?: string | string[];
}

export type Props = CocoonViewProps<Data, ViewState>;

export const Inspector: CocoonView<Data, ViewState> = {
  serialiseViewData: async (context, data: object[], state) => {
    const limit = state.limit === undefined ? 100 : state.limit;
    const serialisedData = JSON.stringify(
      data.length > limit ? data.slice(0, 100) : data
    );
    if (serialisedData.length > 10_000_000) {
      throw new Error(`Inspector received too much data`);
    }
    return serialisedData;
  },
};
