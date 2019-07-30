import { CocoonView } from '@cocoon/types';

export const HTML: CocoonView<string> = {
  defaultPort: {
    incoming: false,
    name: 'html',
  },
  description: `Shows HTML output in the view.`,

  serialiseViewData: async (context, data: string, state) => data,
};
