import React from 'react';
import { ObjectInspector, ObjectLabel, ObjectRootLabel } from 'react-inspector';
import styled from 'styled-components';
import { Props, ViewState } from '../views/Inspector';

export const Inspector = (props: Props) => {
  const { isPreview, viewData, viewState } = props.context;
  return (
    <Wrapper compact={isPreview}>
      <ObjectInspector
        theme="chromeDark"
        data={JSON.parse(viewData)}
        expandLevel={1}
        nodeRenderer={defaultNodeRenderer.bind(null, viewState)}
      ></ObjectInspector>
    </Wrapper>
  );
};

const preview = (
  item: any,
  attribute: string | string[] | undefined,
  fallback: any
) => {
  if (!attribute) {
    return fallback;
  }
  if (typeof attribute === 'string') {
    return item[attribute] || fallback;
  }
  return (
    attribute
      .map(x => item[x])
      .filter(Boolean)
      .join(', ') || fallback
  );
};

const defaultNodeRenderer = (
  viewState: ViewState,
  { depth, name, data, isNonenumerable, expanded }
) =>
  depth === 0 ? (
    <ObjectRootLabel name={name} data={data} />
  ) : (
    <ObjectLabel
      name={preview(data, viewState.preview, name)}
      data={data}
      isNonenumerable={isNonenumerable}
    />
  );

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
