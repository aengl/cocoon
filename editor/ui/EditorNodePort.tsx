import React, { memo, useContext, useState } from 'react';
import {
  DraggableCore,
  DraggableData,
  DraggableEventHandler,
} from 'react-draggable';
import styled from 'styled-components';
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
} from './ContextMenu';
import { EditorContext, IEditorContext } from './Editor';
import { EditorNodeEdge } from './EditorNodeEdge';
import { showTooltip } from './tooltips';

const debug = require('../../common/debug')('editor:EditorNodePort');
const dragThreshhold = 10;

export interface EditorNodePortProps {
  incoming: boolean;
  node: GraphNode;
  port: string;
  positionX: number;
  positionY: number;
  size: number;
}

export const EditorNodePort = memo((props: EditorNodePortProps) => {
  let startX = 0;
  let startY = 0;
  const { incoming, node, port, positionX, positionY, size } = props;
  const [creatingConnection, setCreatingConnection] = useState<boolean | null>(
    null
  );
  const [mousePosition, setMousePosition] = useState<Position | null>(null);

  const onDragStart: DraggableEventHandler = (event, data) => {
    startX = data.x;
    startY = data.y;
  };

  const onDragMove: DraggableEventHandler = (event, data) => {
    if (
      Math.abs(data.x - startX) > dragThreshhold ||
      Math.abs(data.y - startY) > dragThreshhold
    ) {
      const mouseEvent = event as React.MouseEvent;
      setCreatingConnection(true);
      setMousePosition({ x: mouseEvent.clientX, y: mouseEvent.clientY });
    }
  };

  const onDragStop = (
    event: any,
    data: DraggableData,
    context: IEditorContext
  ) => {
    const mouseEvent = event as React.MouseEvent;
    const eventPosition = { x: mouseEvent.clientX, y: mouseEvent.clientY };
    if (creatingConnection === true) {
      const gridPosition = context.translatePositionToGrid(eventPosition);
      const existingNode = context.getNodeAtGridPosition(gridPosition);
      if (existingNode !== undefined) {
        // Create connection for an existing node
        createNodePortsMenu(
          context.translatePosition(eventPosition),
          existingNode,
          context.nodeRegistry,
          !incoming,
          incoming,
          selectedPort => {
            setCreatingConnection(false);
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
          context.translatePosition(eventPosition),
          context.nodeRegistry,
          true,
          !incoming,
          (selectedNodeType, selectedPort) => {
            setCreatingConnection(false);
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

  const inspect = () => {
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

  const createContextMenuForPort = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const template: MenuTemplate = [
      {
        checked: node.hot === true,
        click: inspect,
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

  const editorContext = useContext(EditorContext);
  const translatedPosition =
    creatingConnection && mousePosition
      ? editorContext!.translatePosition(mousePosition)
      : null;
  return (
    <g>
      <DraggableCore
        onStart={onDragStart}
        onDrag={onDragMove}
        onStop={(e, data) => onDragStop(e, data, editorContext!)}
      >
        <Glyph
          cx={positionX}
          cy={positionY}
          r={size}
          onMouseOver={event => {
            showTooltip(event.currentTarget, port);
          }}
          onClick={inspect}
          onContextMenu={createContextMenuForPort}
        />
      </DraggableCore>
      {translatedPosition && (
        <EditorNodeEdge
          fromX={positionX}
          fromY={positionY}
          toX={translatedPosition.x}
          toY={translatedPosition.y}
          ghost={true}
        />
      )}
    </g>
  );
});

const Glyph = styled.circle`
  stroke: transparent;
  stroke-width: 10px;
  fill: var(--color-foreground);

  :hover {
    fill: var(--color-highlight);
  }
`;
