import { CocoonView, CocoonViewProps } from '@cocoon/types';
import _ from 'lodash';

export type Data = string;

export interface ViewState {
  limit?: number;
}

export type Props = CocoonViewProps<Data, ViewState>;

export const Inspector: CocoonView<Data, ViewState> = {
  serialiseViewData: async (context, data: object[], state) => {
    const limit = state.limit === undefined ? 100 : state.limit;
    return JSON.stringify(data.length > limit ? data.slice(0, 100) : data);
  },
};
