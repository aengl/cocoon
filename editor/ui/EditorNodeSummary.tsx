import React from 'react';
import styled from 'styled-components';
import { GraphNode } from '../../common/graph';
import { DataView } from './DataView';

interface EditorNodeSummaryProps {
  height: number;
  node: GraphNode;
  text?: string;
  view: boolean;
  width: number;
  x: number;
  y: number;
}

export const EditorNodeSummary = (props: EditorNodeSummaryProps) => {
  const { height, node, text, view, width, x, y } = props;
  return (
    <foreignObject x={x} y={y} width={width} height={height}>
      <div
        style={{
          visibility: view ? 'visible' : 'hidden',
        }}
      >
        <DataView
          node={node}
          width={width}
          height={height}
          isPreview={true}
          viewDataId={node.state.viewDataId}
        />
      </div>
      <Summary>{text}</Summary>
    </foreignObject>
  );
};

const Summary = styled.p`
  font-size: var(--font-size-small);
  text-align: center;
  opacity: 0.6;
  padding: 0 5px;
  margin: 0;
`;
