import { CocoonView, CocoonViewProps } from '@cocoon/types';
import _ from 'lodash';

export type Data = string;

export interface ViewState {
  expandLevel?: number;
  expandPaths?: string | string[];
  limit?: number;
  preview?: string | string[];
}

export type Props = CocoonViewProps<Data, ViewState>;

export const Inspector: CocoonView<Data, ViewState> = {
  description: `A data inspector, similar to the inspection tool in the Chrome devtools.`,
  stateDescriptions: {
    expandLevel: `See https://github.com/storybookjs/react-inspector#api`,
    expandPaths: `See https://github.com/storybookjs/react-inspector#api`,
    limit: `If the data is an array, limits the number of items that are shown in the inspector. (default: \`100\`)`,
    preview: `List of attributes to preview inline when summarising objects.`,
  },

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
