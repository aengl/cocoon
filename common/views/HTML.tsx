import React from 'react';
import { ViewObject, ViewProps } from '../view';

export const HTMLComponent = (props: ViewProps<string>) => {
  const { viewData } = props.context;
  return (
    <div
      dangerouslySetInnerHTML={{
        __html: viewData,
      }}
    />
  );
};

export const HTML: ViewObject<string> = {
  component: HTMLComponent,
  defaultPort: {
    incoming: false,
    name: 'html',
  },

  serialiseViewData: async (context, data: string, state) => data,
};
