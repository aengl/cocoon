import React from 'react';
import { ViewObject, ViewProps } from '../view';

export interface ImageData {
  base64: string;
}

export interface ImageState {
  src: string;
}

export const ImageComponent = (props: ViewProps<ImageData, ImageState>) => {
  const { viewData } = props.context;
  return (
    <img
      src={`data:image/png;base64,${viewData.base64}`}
      style={{
        maxHeight: '100%',
        maxWidth: '100%',
        objectFit: 'contain',
      }}
    />
  );
};

export const Image: ViewObject<ImageData, ImageState> = {
  component: ImageComponent,

  serialiseViewData: async (context, data, state) => {
    const { fs } = context;
    return {
      base64: await fs.readFile(state.src, {
        encoding: 'base64',
        root: context.definitions.root,
      }),
    };
  },
};
