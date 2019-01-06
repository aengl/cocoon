import React from 'react';
import {
  DraggableCore,
  DraggableData,
  DraggableEventHandler,
} from 'react-draggable';
import { GraphNode, nodeIsConnected } from '../../common/graph';
import {
  sendCreateEdge,
  sendCreateNode,
  sendCreateView,
  sendPortDataRequest,
  sendRemoveEdge,
  sendRemoveView,
} from '../../common/ipc';
import { Position } from '../../common/math';
import {
  createContextMenu,
  createNodePortsMenu,
  createNodeTypeMenu,
  createViewTypeMenuTemplate,
  MenuItemType,
  MenuTemplate,
} from './contextMenu';
import { EditorContext } from './Editor';
import { EditorNodeEdge } from './EditorNodeEdge';
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

  onDragStart: DraggableEventHandler = (event, data) => {
    this.startX = data.x;
    this.startY = data.y;
  };

  onDragMove: DraggableEventHandler = (event, data) => {
    if (
      Math.abs(data.x - this.startX!) > dragThreshhold ||
      Math.abs(data.y - this.startY!) > dragThreshhold
    ) {
      const mouseEvent = event as React.MouseEvent;
      this.setState({
        creatingConnection: true,
        mousePosition: { x: mouseEvent.clientX, y: mouseEvent.clientY },
      });
    }
  };

  onDragStop = (event: any, data: DraggableData, context: EditorContext) => {
    const { port, node, incoming } = this.props;
    const { creatingConnection } = this.state;
    const { editor } = context;
    const mouseEvent = event as React.MouseEvent;
    const position = { x: mouseEvent.clientX, y: mouseEvent.clientY };
    if (creatingConnection === true) {
      const gridPosition = editor.translatePositionToGrid(position);
      const existingNode = editor.getNodeAtGridPosition(gridPosition);
      if (existingNode !== undefined) {
        // Create connection for an existing node
        createNodePortsMenu(
          editor.translatePosition(position),
          existingNode,
          context.nodeRegistry,
          !incoming,
          incoming,
          selectedPort => {
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
          }
        );
      } else {
        // Create a new, connected node
        createNodeTypeMenu(
          editor.translatePosition(position),
          context.nodeRegistry,
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

  createContextMenuForPort = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const { node, port, incoming } = this.props;
    const template: MenuTemplate = [
      {
        checked: node.hot === true,
        click: this.inspect,
        label: 'Inspect',
      },
      {
        label: node.view === undefined ? 'Create View' : 'Change View',
        submenu: createViewTypeMenuTemplate(selectedViewType => {
          if (selectedViewType !== undefined) {
            sendCreateView({
              nodeId: node.id,
              port: { incoming, name: port },
              type: selectedViewType,
            });
          }
        }),
      },
    ];
    if (node.view !== undefined) {
      template.push({
        click: () => {
          sendRemoveView({ nodeId: node.id });
        },
        label: 'Remove View',
      });
    }
    if (incoming && nodeIsConnected(node, port)) {
      template.push({ type: MenuItemType.Separator });
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
    createContextMenu(
      {
        x: event.pageX,
        y: event.pageY,
      },
      template
    );
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
