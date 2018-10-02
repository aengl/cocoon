import electron from 'electron';
import React from 'react';
import { CocoonDefinitions, CocoonNode } from '../../core/definitions';

const definitions = electron.remote.require('../core/definitions');

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
    const cx = node.x * gridX;
    const cy = node.y * gridY;
    const x = cx - gridX / 2;
    const y = cy - gridY / 2;
    return (
      <g transform={`translate(${x},${y})`}>
        <text
          x={gridX / 2}
          y={gridY / 2 - 30}
          fill="white"
          alignment-baseline="middle"
          text-anchor="middle"
        >
          {node.type}
        </text>
        <circle cx={gridX / 2} cy={gridY / 2} r="15" fill="white" />
      </g>
    );
  }
}
