import React from 'react';
import { DraggableCore, DraggableData } from 'react-draggable';
import { CocoonNode } from '../../common/graph';
import { sendCreateNode, sendPortDataRequest } from '../../common/ipc';
import { Position } from '../../common/math';
import { EditorContext } from './Editor';
import { EditorNodeEdge } from './EditorNodeEdge';
import { createNodeTypeMenu } from './menus';
import { showTooltip } from './tooltips';

const debug = require('../../common/debug')('editor:EditorNodePort');
const dragThreshhold = 10;

export interface EditorNodePortProps {
  name: string;
  node: CocoonNode;
  position: Position;
  size: number;
}

export interface EditorNodePortState {
  creatingConnection?: boolean;
  mousePosition?: Position;
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
      Math.abs(data.x - this.startX!) > dragThreshhold ||
      Math.abs(data.y - this.startY!) > dragThreshhold
    ) {
      this.setState({
        creatingConnection: true,
        mousePosition: { x: e.x, y: e.y },
      });
    }
  };

  onDragStop = (e: MouseEvent, data: DraggableData, context: EditorContext) => {
    const { name, node } = this.props;
    const { creatingConnection } = this.state;
    if (creatingConnection === true) {
      createNodeTypeMenu(true, (selectedNodeType, selectedPort) => {
        this.setState({ creatingConnection: false });
        if (selectedNodeType !== undefined) {
          sendCreateNode({
            connectedNodeId: node.id,
            connectedNodePort: name,
            connectedPort: selectedPort!,
            gridPosition: context.editor.translatePositionToGrid({
              x: e.x,
              y: e.y,
            }),
            type: selectedNodeType,
          });
        }
      });
    }
  };

  render() {
    const { name, node, position, size } = this.props;
    const { creatingConnection, mousePosition } = this.state;
    return (
      <EditorContext.Consumer>
        {context => (
          <g className="EditorNodePort">
            <DraggableCore
              onStart={this.onDragStart}
              onDrag={this.onDragMove}
              onStop={(e, data) => this.onDragStop(e, data, context!)}
            >
              <circle
                className="EditorNodePort__glyph"
                cx={position.x}
                cy={position.y}
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
            {creatingConnection === true && mousePosition !== undefined && (
              <EditorNodeEdge
                from={position}
                to={context!.editor.translatePosition(mousePosition)}
                ghost={true}
              />
            )}
          </g>
        )}
      </EditorContext.Consumer>
    );
  }
}
