import { CocoonViewProps } from '@cocoon/types';
import React from 'react';

export interface ImageData {
  base64: string;
}

export interface ImageState {
  src: string;
}

export const Image = (props: CocoonViewProps<ImageData, ImageState>) => {
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
