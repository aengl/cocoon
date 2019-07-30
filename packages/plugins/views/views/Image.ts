import { CocoonView } from '@cocoon/types';
import fs from 'fs';

export interface ImageData {
  base64: string;
}

export interface ImageState {
  src: string;
}

export const Image: CocoonView<ImageData, ImageState> = {
  description: `Reads a single image from the filesystem and sends it to the view in base64.`,

  serialiseViewData: async (context, data, state) => {
    return {
      base64: await fs.promises.readFile(state.src, { encoding: 'base64' }),
    };
  },
};
