import { MenuItemConstructorOptions } from 'electron';
import React from 'react';
import { DraggableCore, DraggableData } from 'react-draggable';
import { GraphNode, nodeIsConnected } from '../../common/graph';
import {
  sendCreateEdge,
  sendCreateNode,
  sendPortDataRequest,
  sendRemoveEdge,
} from '../../common/ipc';
import { Position } from '../../common/math';
import { EditorContext } from './Editor';
import { EditorNodeEdge } from './EditorNodeEdge';
import {
  createMenuFromTemplate,
  createNodePortsMenu,
  createNodeTypeMenu,
} from './menus';
import { showTooltip } from './tooltips';

const debug = require('../../common/debug')('editor:EditorNodePort');
const dragThreshhold = 10;

export interface EditorNodePortProps {
  incoming: boolean;
  port: string;
  node: GraphNode;
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
    const { port, node, incoming } = this.props;
    const { creatingConnection } = this.state;
    const { editor } = context;
    if (creatingConnection === true) {
      const gridPosition = editor.translatePositionToGrid({
        x: e.x,
        y: e.y,
      });
      const existingNode = editor.getNodeAtGridPosition(gridPosition);
      if (existingNode !== undefined) {
        // Create connection for an existing node
        createNodePortsMenu(existingNode, !incoming, incoming, selectedPort => {
          this.setState({ creatingConnection: false });
          if (selectedPort !== undefined) {
            incoming
              ? sendCreateEdge({
                  fromNodeId: existingNode.id,
                  fromNodePort: selectedPort,
                  toNodeId: node.id,
                  toNodePort: port,
                })
              : sendCreateEdge({
                  fromNodeId: node.id,
                  fromNodePort: port,
                  toNodeId: existingNode.id,
                  toNodePort: selectedPort,
                });
          }
        });
      } else {
        // Create a new, connected node
        createNodeTypeMenu(
          true,
          !incoming,
          (selectedNodeType, selectedPort) => {
            this.setState({ creatingConnection: false });
            if (selectedNodeType !== undefined && selectedPort !== undefined) {
              incoming
                ? sendCreateNode({
                    edge: {
                      fromNodePort: selectedPort,
                      toNodeId: node.id,
                      toNodePort: port,
                    },
                    gridPosition,
                    type: selectedNodeType,
                  })
                : sendCreateNode({
                    edge: {
                      fromNodeId: node.id,
                      fromNodePort: port,
                      toNodePort: selectedPort,
                    },
                    gridPosition,
                    type: selectedNodeType,
                  });
            }
          }
        );
      }
    }
  };

  inspect = () => {
    const { node, port, incoming } = this.props;
    sendPortDataRequest(
      {
        nodeId: node.id,
        port: { name: port, incoming },
      },
      args => {
        debug(`got data for "${node.id}/${port}"`, args.data);
      }
    );
  };

  createContextMenuForPort = () => {
    const { node, port, incoming } = this.props;
    const template: MenuItemConstructorOptions[] = [
      {
        checked: node.state.hot === true,
        click: this.inspect,
        label: 'Inspect',
      },
    ];
    if (incoming && nodeIsConnected(node, port)) {
      template.push({ type: 'separator' });
      template.push({
        click: () => {
          sendRemoveEdge({
            nodeId: node.id,
            port: { name: port, incoming },
          });
        },
        label: 'Disconnect',
      });
    }
    createMenuFromTemplate(template);
  };

  render() {
    const { port, position, size } = this.props;
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
                  showTooltip(event.currentTarget, port);
                }}
                onClick={this.inspect}
                onContextMenu={this.createContextMenuForPort}
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
