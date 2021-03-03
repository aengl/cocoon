import { GraphNode, NodeStatus } from '@cocoon/types';
import React, { useContext } from 'react';
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
    <foreignObject x={x} y={y} width={width} height={height}>
      <div
        className="summary"
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
      </div>
      {node.view && (
        <div className="view">
          <DataView
            height={height}
            isPreview={true}
            node={node}
            registry={editorContext.registry}
            viewDataId={node.state.viewDataId}
            width={width}
          />
        </div>
      )}
      <style jsx>{`
        foreignObject {
          position: relative;
        }
        .summary {
          visibility: ${!showView ? 'visible' : 'collapse'};
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
        }
        .view {
          visibility: ${showView ? 'visible' : 'collapse'};
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
        }
      `}</style>
    </foreignObject>
  );
};
