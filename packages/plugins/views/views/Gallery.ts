import { CocoonView } from '@cocoon/types';

export type ViewData = Array<
  | string
  | {
      src: string;
      title?: string;
    }
>;

export interface ViewState {
  size?: number;
  limit?: number;
}

export const Gallery: CocoonView<ViewData, ViewState> = {
  description: `Shows a gallery of remote images.`,
  stateDescriptions: {
    limit: `Limits the number of images shown. (default: \`50\`)`,
    size: `Height of the gallery images.`,
  },

  serialiseViewData: async (context, data: any[], state) => {
    const limit = state.limit === undefined ? 50 : state.limit;
    const filteredData = data.filter(x =>
      typeof x === 'string' ? Boolean(x) : Boolean(x.src)
    );
    return limit ? filteredData.slice(0, limit) : filteredData;
  },
};
