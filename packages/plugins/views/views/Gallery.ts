import { CocoonView } from '@cocoon/types';
import { ViewData, ViewState } from '../components/Gallery';

export const Gallery: CocoonView<ViewData, ViewState> = {
  description: `Shows a gallery of remote images.`,

  serialiseViewData: async (context, data: any[], state) => {
    const limit = state.limit === undefined ? 50 : state.limit;
    const filteredData = data.filter(x =>
      typeof x === 'string' ? Boolean(x) : Boolean(x.src)
    );
    return limit ? filteredData.slice(0, limit) : filteredData;
  },
};
