import { CocoonViewProps } from '@cocoon/types';
import React from 'react';
import styled from 'styled-components';

export type ViewData = Array<
  | string
  | {
      src: string;
      title?: string;
    }
>;

export interface ViewState {
  height?: number;
  limit?: number;
}

export const Gallery = (props: CocoonViewProps<ViewData, ViewState>) => {
  const height = props.isPreview
    ? 30
    : props.viewState.height
    ? props.viewState.height
    : 200;
  return (
    <Wrapper>
      {props.viewData.map(item =>
        typeof item === 'string' ? (
          <img key={item} src={item} height={height} />
        ) : (
          <img
            key={item.src}
            title={item.title || item.src.slice(item.src.lastIndexOf('/') + 1)}
            src={item.src}
            height={height}
          />
        )
      )}
    </Wrapper>
  );
};

const Wrapper = styled.div`
  text-align: center;
  overflow-y: scroll;
  & img {
    margin: 2px;
  }
`;
