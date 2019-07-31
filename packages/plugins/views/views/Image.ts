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

  serialiseViewData: async (context, data, state) => {
    return {
      base64: await fs.promises.readFile(state.src, { encoding: 'base64' }),
    };
  },
};
