import React from 'react';
import { DraggableCore, DraggableData } from 'react-draggable';
import { sendPortDataRequest } from '../../common/ipc';
import { CocoonNode } from '../../common/node';
import { EditorNodeEdge } from './EditorNodeEdge';
import { createNewNodeMenu } from './menus';
import { showTooltip } from './tooltips';

const debug = require('../../common/debug')('editor:EditorNodePort');
const dragThreshhold = 10;

export interface EditorNodePortProps {
  name: string;
  node: CocoonNode;
  y: number;
  x: number;
  size: number;
}

export interface EditorNodePortState {
  creatingConnection?: boolean;
  mouseX?: number;
  mouseY?: number;
}

export class EditorNodePort extends React.PureComponent<
  EditorNodePortProps,
  EditorNodePortState
> {
  startX?: number;
  startY?: number;

  constructor(props) {
    super(props);
    this.state = {};
  }

  onDragStart = (e: MouseEvent, data: DraggableData) => {
    this.startX = data.x;
    this.startY = data.y;
  };

  onDragMove = (e: MouseEvent, data: DraggableData) => {
    if (
      Math.abs(data.x - this.startX) > dragThreshhold ||
      Math.abs(data.y - this.startY) > dragThreshhold
    ) {
      this.setState({
        creatingConnection: true,
        mouseX: e.x,
        mouseY: e.y,
      });
    }
  };

  onDragStop = (e: MouseEvent, data: DraggableData) => {
    const { creatingConnection } = this.state;
    if (creatingConnection) {
      createNewNodeMenu().on('menu-will-close', () => {
        this.setState({ creatingConnection: false });
      });
    }
  };

  render() {
    const { name, node, x, y, size } = this.props;
    const { creatingConnection, mouseX, mouseY } = this.state;
    return (
      <g className="EditorNodePort">
        <DraggableCore
          onStart={this.onDragStart}
          onDrag={this.onDragMove}
          onStop={this.onDragStop}
        >
          <circle
            className="EditorNodePort__glyph"
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
        </DraggableCore>
        {creatingConnection && (
          <EditorNodeEdge
            fromX={x}
            fromY={y}
            toX={mouseX}
            toY={mouseY}
            ghost={true}
          />
        )}
      </g>
    );
  }
}
