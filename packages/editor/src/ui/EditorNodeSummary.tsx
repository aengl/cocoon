import { GraphNode, NodeStatus } from '@cocoon/types';
import React, { useContext } from 'react';
import styled from 'styled-components';
import { DataView } from './DataView';
import { EditorContext } from './Editor';

const debug = require('debug')('ui:EditorNodeSummary');

interface EditorNodeSummaryProps {
  error?: Error;
  height: number;
  node: GraphNode;
  width: number;
  x: number;
  y: number;
}

export const EditorNodeSummary = (props: EditorNodeSummaryProps) => {
  const { error, height, node, width, x, y } = props;
  const editorContext = useContext(EditorContext)!;
  const showView =
    node.state.viewData && node.state.status !== NodeStatus.processing;
  return (
    <Wrapper x={x} y={y} width={width} height={height}>
      <Summary
        visible={!showView}
        onClick={() => {
          debug(`summary for ${node.id}:`, node.state.summary);
        }}
      >
        {error
          ? error.message || error.toString()
          : node.state.summary
          ? node.state.summary
              .split('\n\n')
              .map((text, i) => <p key={i}>{text}</p>)
          : null}
      </Summary>
      {node.view && (
        <ViewContainer visible={showView}>
          <DataView
            height={height}
            isPreview={true}
            node={node}
            registry={editorContext.registry}
            viewDataId={node.state.viewDataId}
            width={width}
          />
        </ViewContainer>
      )}
    </Wrapper>
  );
};

const Wrapper = styled.foreignObject`
  position: relative;
`;

const ViewContainer = styled.div`
  visibility: ${(props: { visible: boolean }) =>
    props.visible ? 'visible' : 'collapse'};
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
`;

const Summary = styled.div`
  visibility: ${(props: { visible: boolean }) =>
    props.visible ? 'visible' : 'collapse'};
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  color: var(--color-faded);
  font-size: var(--font-size-small);
  text-align: center;
  padding: 0 5px;
  margin: 0;
`;
