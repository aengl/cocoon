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
    const x = node.x * gridX;
    const y = node.y * gridY;
    return <circle cx={x} cy={y} r="15" fill="white" />;
  }
}
