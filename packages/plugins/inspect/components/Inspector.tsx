import React from 'react';
import { ObjectInspector } from 'react-inspector';
import styled from 'styled-components';
import { Props } from '../views/Inspector';

export const Inspector = (props: Props) => {
  const { isPreview, viewData } = props.context;
  return (
    <Wrapper compact={isPreview}>
      <ObjectInspector
        theme="chromeDark"
        data={JSON.parse(viewData)}
        expandLevel={1}
      ></ObjectInspector>
    </Wrapper>
  );
};

const Wrapper = styled.div<{
  compact?: boolean;
}>`
  height: 100%;
  text-align: left;
  padding: ${props => (props.compact ? '0' : '0.2em 0.5em')};
  pointer-events: ${props => (props.compact ? 'none' : 'all')};
  li {
    background-color: transparent !important;
    font-size: ${props => (props.compact ? '8px' : '11px')} !important;
    line-height: ${props => (props.compact ? '1' : '1.2')} !important;
  }
`;
