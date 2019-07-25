import _ from 'lodash';
import React from 'react';
import { ObjectInspector, ObjectLabel, ObjectRootLabel } from 'react-inspector';
import styled from 'styled-components';
import { Props, ViewState } from '../views/Inspector';

export const Inspector = (props: Props) => {
  const { isPreview, viewData, viewState } = props.context;
  return (
    <Wrapper compact={isPreview}>
      <ObjectInspector
        data={JSON.parse(viewData)}
        expandLevel={
          viewState.expandLevel === undefined ? 1 : viewState.expandLevel
        }
        expandPaths={viewState.expandPaths}
        nodeRenderer={defaultNodeRenderer.bind(null, viewState)}
        theme="chromeDark"
      ></ObjectInspector>
    </Wrapper>
  );
};

const preview = (
  item: any,
  attribute: string | string[] | undefined,
  name: any
) => {
  if (!attribute) {
    return name;
  }
  const previewString =
    typeof attribute === 'string'
      ? _.get(item, attribute)
      : attribute
          .map(x => _.get(item, x))
          .filter(Boolean)
          .join(', ');
  return previewString ? `${name}: ${previewString}` : name;
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
  overflow-y: scroll;
  padding: ${props => (props.compact ? '0' : '0.2em 0.5em')};
  li {
    background-color: transparent !important;
    font-size: ${props => (props.compact ? '8px' : '11px')} !important;
    line-height: ${props => (props.compact ? '1' : '1.2')} !important;
  }
`;
