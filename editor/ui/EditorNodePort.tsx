import React from 'react';
import { sendPortDataRequest } from '../../common/ipc';
import { CocoonNode } from '../../common/node';
import { showTooltip } from './tooltips';

const debug = require('../../common/debug')('editor:EditorNodePort');

export interface EditorNodePortProps {
  name: string;
  node: CocoonNode;
  y: number;
  x: number;
  size: number;
}

export interface EditorNodePortState {}

export class EditorNodePort extends React.PureComponent<
  EditorNodePortProps,
  EditorNodePortState
> {
  render() {
    const { name, node, x, y, size } = this.props;
    return (
      <circle
        className="EditorNodePort"
        cx={x}
        cy={y}
        r={size}
        onMouseOver={event => {
          showTooltip(event.currentTarget, name);
        }}
        onClick={() => {
          debug(`requested data for "${node.id}/${name}"`);
          sendPortDataRequest({
            nodeId: node.id,
            port: name,
          });
        }}
      />
    );
  }
}
