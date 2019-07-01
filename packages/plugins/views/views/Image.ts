import { CocoonView } from '@cocoon/types';

export interface ImageData {
  base64: string;
}

export interface ImageState {
  src: string;
}

export const Image: CocoonView<ImageData, ImageState> = {
  serialiseViewData: async (context, data, state) => {
    const { fs } = context;
    return {
      base64: await fs.readFile(state.src, {
        encoding: 'base64',
      }),
    };
  },
};
