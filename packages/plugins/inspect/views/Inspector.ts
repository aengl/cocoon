import { CocoonView, CocoonViewProps } from '@cocoon/types';

export type ViewData = string;

export interface ViewState {
  expandLevel?: number;
  expandPaths?: string | string[];
  limit?: number;
  maxSize?: number;
  preview?: string | string[];
}

export type Props = CocoonViewProps<ViewData, ViewState>;

export const Inspector: CocoonView<ViewData, ViewState> = {
  description: `A data inspector, similar to the inspection tool in the Chrome devtools.`,
  stateDescriptions: {
    expandLevel: `See https://github.com/storybookjs/react-inspector#api`,
    expandPaths: `See https://github.com/storybookjs/react-inspector#api`,
    limit: `If the data is an array, limits the number of items that are shown in the inspector. (default: \`100\`)`,
    maxSize: `The maximum allowed serialised data size in bytes. (default: 10 000 000)`,
    preview: `List of attributes to preview inline when summarising objects.`,
  },

  serialiseViewData: async (context, data: any[], state) => {
    const limit = state.limit || 100;
    const maxSize = state.maxSize || 10_000_000;
    const serialisedData = JSON.stringify(
      data.length > limit ? data.slice(0, limit) : data
    );
    if (serialisedData.length > maxSize) {
      throw new Error(
        `Inspector received too much data (${Math.round(
          serialisedData.length / 1024 / 1024
        )} MB)`
      );
    }
    return serialisedData;
  },
};
