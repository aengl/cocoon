import { ipcRenderer } from 'electron';
import React from 'react';
import ReactDOM from 'react-dom';
import { CocoonNode, NodeStatus } from '../../core/graph';
import { createNodeInstance } from '../../core/nodes/create';

const debug = require('debug')('cocoon:Node');

export interface EditorNodeProps {
  gridX?: number;
  gridY?: number;
  node: CocoonNode;
}

export interface EditorNodeState {
  status: NodeStatus;
}

export class EditorNode extends React.PureComponent<
  EditorNodeProps,
  EditorNodeState
> {
  public static defaultProps: Partial<EditorNodeProps> = {
    gridX: 150,
    gridY: 100,
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
          // DEBUG:
          this.forceUpdate();
        }
      }
    );
  }

  render() {
    const { node, gridX, gridY } = this.props;
    debug('render', node.definition.id, node.status);
    debug(node);
    const cx = node.definition.x * gridX;
    const cy = node.definition.y * gridY;
    const x = cx - gridX / 2;
    const y = cy - gridY / 2;
    const color = getNodeColor(node.status);
    const overlay = ReactDOM.createPortal(
      this.renderData(x, y + gridY),
      document.getElementById('portals')
    );
    return (
      <g transform={`translate(${x},${y})`}>
        <text x={gridX / 2} y={gridY / 2 - 25} fill={color} textAnchor="middle">
          {node.type}
        </text>
        <circle cx={gridX / 2} cy={gridY / 2} r="15" fill={color} />
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

  renderData(x: number, y: number) {
    const { node, gridX, gridY } = this.props;
    const nodeInstance = createNodeInstance(node.type);
    if (nodeInstance.renderData) {
      return (
        <div
          className="Node__portal"
          style={{
            height: gridY,
            left: x,
            top: y,
            width: gridX,
          }}
        >
          {nodeInstance.renderData(node, gridX, gridY)}
        </div>
      );
    }
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
