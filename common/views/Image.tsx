import fs from 'fs';
import React from 'react';
import { ViewComponent, ViewObject } from '../view';

export interface ImageData {
  base64: string;
}

export interface ImageState {
  src: string;
}

export class ImageComponent extends ViewComponent<ImageData, ImageState> {
  shouldComponentSync() {
    return false;
  }

  render() {
    const { viewData } = this.props.context;
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
  }
}

export const Image: ViewObject<ImageData, ImageState> = {
  component: ImageComponent,

  serialiseViewData: (context, data, state) => {
    const bitmap = fs.readFileSync(state.src);
    return {
      base64: new Buffer(bitmap).toString('base64'),
    };
  },
};
