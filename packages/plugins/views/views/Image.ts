import { CocoonView } from '@cocoon/types';
import fs from 'fs';

export interface ViewData {
  base64: string;
}

export interface ViewState {
  src: string;
}

export const Image: CocoonView<ViewData, ViewState> = {
  description: `Reads a single image from the filesystem and sends it to the view in base64.`,

  stateDescriptions: {
    src: `The local file path.`,
  },

  defaultPort: {
    incoming: false,
    name: 'src',
  },

  serialiseViewData: async (context, data, state) => {
    const src = state.src || data;
    return {
      base64: await fs.promises.readFile(src, { encoding: 'base64' }),
    };
  },
};
