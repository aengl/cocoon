import { CocoonView } from 'cocoon-node';

export const HTML: CocoonView<string> = {
  defaultPort: {
    incoming: false,
    name: 'html',
  },

  serialiseViewData: async (context, data: string, state) => data,
};
