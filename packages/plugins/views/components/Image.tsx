import { CocoonViewProps } from '@cocoon/types';
import React from 'react';
import { ViewData, ViewState } from '../views/Image';

export const Image = (props: CocoonViewProps<ViewData, ViewState>) => {
  const { viewData } = props;
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
