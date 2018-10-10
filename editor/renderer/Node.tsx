import React from 'react';
import ReactDOM from 'react-dom';
import { CocoonDefinitions } from '../../core/definitions';
import { CocoonNode, NodeStatus } from '../../core/graph';
import { createNodeInstance } from '../../core/nodes/create';

export interface EditorNodeProps {
  gridX?: number;
  gridY?: number;
  node: CocoonNode;
}

export interface EditorNodeState {
  definitions?: CocoonDefinitions;
}

export class EditorNode extends React.Component<
  EditorNodeProps,
  EditorNodeState
> {
  public static defaultProps: Partial<EditorNodeProps> = {
    gridX: 150,
    gridY: 100,
  };

  constructor(props) {
    super(props);
    this.state = {};
  }

  render() {
    const { node, gridX, gridY } = this.props;
    const cx = node.definition.x * gridX;
    const cy = node.definition.y * gridY;
    const x = cx - gridX / 2;
    const y = cy - gridY / 2;
    const color = getNodeColor(node.status);
    const overlay = ReactDOM.createPortal(
      this.renderData(),
      document.getElementById('portals')
    );
    return (
      <g transform={`translate(${x},${y})`}>
        <text x={gridX / 2} y={gridY / 2 - 25} fill={color} textAnchor="middle">
          {node.type}
        </text>
        <circle cx={gridX / 2} cy={gridY / 2} r="15" fill={color} />
        {overlay}
      </g>
    );
  }

  renderData() {
    const { node } = this.props;
    const nodeInstance = createNodeInstance(node.type);
    if (nodeInstance.renderData) {
      return nodeInstance.renderData(node);
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
