import { CocoonViewProps } from '@cocoon/types';
import React from 'react';

export const HTML = (props: CocoonViewProps<string>) => {
  const { viewData } = props;
  return (
    <div
      dangerouslySetInnerHTML={{
        __html: viewData,
      }}
    />
  );
};
