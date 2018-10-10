import { ipcRenderer } from 'electron';
import React from 'react';
import ReactDOM from 'react-dom';
import { CocoonNode, NodeStatus } from '../../core/graph';
import { DataView } from './DataView';

const debug = require('debug')('cocoon:EditorNode');

export interface EditorNodeProps {
  node: CocoonNode;
  gridX: number;
  gridY: number;
  gridWidth?: number;
  gridHeight?: number;
}

export interface EditorNodeState {
  status: NodeStatus;
}

export class EditorNode extends React.PureComponent<
  EditorNodeProps,
  EditorNodeState
> {
  public static defaultProps: Partial<EditorNodeProps> = {
    gridHeight: 100,
    gridWidth: 150,
  };

  constructor(props) {
    super(props);
    const { node } = this.props;
    this.state = {
      status: node.status,
    };
    ipcRenderer.on(
      'node-status-update',
      (event: Electron.Event, nodeId: string, status: NodeStatus) => {
        if (nodeId === node.definition.id) {
          this.setState({ status });
        }
      }
    );
    ipcRenderer.on(
      'node-evaluated',
      (event: Electron.Event, nodeId: string, status: NodeStatus) => {
        if (nodeId === node.definition.id) {
          this.forceUpdate();
        }
      }
    );
  }

  render() {
    const { node, gridX, gridY, gridWidth, gridHeight } = this.props;
    debug('render', node.definition.id, node.status);
    const cx = gridX * gridWidth;
    const cy = gridY * gridHeight;
    const x = cx - gridWidth / 2;
    const y = cy - gridHeight / 2;
    const color = getNodeColor(node.status);
    const overlay = ReactDOM.createPortal(
      <DataView
        nodeId={node.definition.id}
        nodeType={node.type}
        renderingData={node.renderingData}
        x={x}
        y={y + gridHeight}
        width={gridWidth}
        height={gridHeight}
      />,
      document.getElementById('portals')
    );
    return (
      <g transform={`translate(${x},${y})`}>
        <text
          x={gridWidth / 2}
          y={gridHeight / 2 - 25}
          fill={color}
          textAnchor="middle"
        >
          {node.type}
        </text>
        <circle cx={gridWidth / 2} cy={gridHeight / 2} r="15" fill={color} />
        <div
          style={{
            left: x,
            position: 'absolute',
            top: y,
          }}
        >
          {overlay}
        </div>
      </g>
    );
  }
}

function getNodeColor(status: NodeStatus) {
  if (status === NodeStatus.cached) {
    return 'yellow';
  } else if (status === NodeStatus.processing) {
    return 'blue';
  } else if (status === NodeStatus.error) {
    return 'red';
  }
  return 'white';
}
