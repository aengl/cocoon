import { CocoonViewProps } from 'cocoon-node';
import React from 'react';

export const HTML = (props: CocoonViewProps<string>) => {
  const { viewData } = props.context;
  return (
    <div
      dangerouslySetInnerHTML={{
        __html: viewData,
      }}
    />
  );
};
