import React from 'react';
import { CocoonView, CocoonViewProps } from '../view';

export const HTMLComponent = (props: CocoonViewProps<string>) => {
  const { viewData } = props.context;
  return (
    <div
      dangerouslySetInnerHTML={{
        __html: viewData,
      }}
    />
  );
};

export const HTML: CocoonView<string> = {
  component: HTMLComponent,
  defaultPort: {
    incoming: false,
    name: 'html',
  },

  serialiseViewData: async (context, data: string, state) => data,
};
