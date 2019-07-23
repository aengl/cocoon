import {
  sendCreateEdge,
  sendCreateNode,
  sendCreateView,
  sendRemoveEdge,
  sendRemoveView,
  sendRequestPortData,
} from '@cocoon/ipc';
import { GraphNode, Position } from '@cocoon/types';
import React, { memo, useContext, useState } from 'react';
import {
  DraggableCore,
  DraggableData,
  DraggableEventHandler,
} from 'react-draggable';
import styled from 'styled-components';
import {
  createNodePortsMenuTemplate,
  createNodeTypePortMenuTemplate,
  createViewTypeMenuTemplate,
  MenuItemType,
  MenuTemplate,
} from './ContextMenu';
import { EditorContext, IEditorContext } from './Editor';
import { EditorNodeEdge } from './EditorNodeEdge';
import { theme } from './theme';
import { Tooltip } from './Tooltip';

const debug = require('debug')('editor:EditorNodePort');

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
  const editorContext = useContext(EditorContext)!;

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
      const template =
        existingNode !== undefined
          ? // Create connection for an existing node
            createNodePortsMenuTemplate(
              existingNode,
              !incoming,
              selectedPort => {
                setCreatingConnection(false);
                sendCreateEdge(
                  incoming
                    ? {
                        fromNodeId: existingNode.id,
                        fromNodePort: selectedPort,
                        toNodeId: node.id,
                        toNodePort: port,
                      }
                    : {
                        fromNodeId: node.id,
                        fromNodePort: port,
                        toNodeId: existingNode.id,
                        toNodePort: selectedPort,
                      }
                );
              }
            )
          : // Create a new, connected node
            createNodeTypePortMenuTemplate(
              context.registry,
              !incoming,
              (selectedNodeType, selectedPort) => {
                setCreatingConnection(false);
                sendCreateNode({
                  edge: incoming
                    ? {
                        fromNodePort: selectedPort!,
                        toNodeId: node.id,
                        toNodePort: port,
                      }
                    : {
                        fromNodeId: node.id,
                        fromNodePort: port,
                        toNodePort: selectedPort!,
                      },
                  gridPosition,
                  type: selectedNodeType,
                });
              }
            );

      editorContext.contextMenu.current!.create(
        editorContext.translatePosition({
          x: event.clientX,
          y: event.clientY,
        }),
        template,
        () => {
          setCreatingConnection(false);
        }
      );
    }
  };

  const inspect = (sampleSize?: number) => {
    sendRequestPortData(
      {
        nodeId: node.id,
        port: { name: port, incoming },
        sampleSize,
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
        click: () => inspect(),
        label: 'Inspect',
      },
      {
        click: () => inspect(1),
        label: 'Sample',
      },
      {
        label: node.view === undefined ? 'Create View' : 'Change View',
        submenu: createViewTypeMenuTemplate(
          editorContext.registry!,
          selectedViewType => {
            sendCreateView({
              nodeId: node.id,
              port: { incoming, name: port },
              type: selectedViewType,
            });
          }
        ),
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
    if (incoming && node.edgesIn.some(edge => edge.toPort === port)) {
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
    editorContext.contextMenu.current!.create(
      editorContext.translatePosition({
        x: event.clientX,
        y: event.clientY,
      }),
      template
    );
  };

  const translatedPosition =
    creatingConnection && mousePosition
      ? editorContext.translatePosition(mousePosition)
      : null;
  return (
    <Tooltip text={port}>
      <g>
        <DraggableCore
          onStart={onDragStart}
          onDrag={onDragMove}
          onStop={(e, data) => onDragStop(e, data, editorContext)}
        >
          <Glyph
            cx={positionX}
            cy={positionY}
            r={size}
            onClick={() => inspect()}
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
    </Tooltip>
  );
});

const Glyph = styled.circle`
  stroke: transparent;
  stroke-width: 10px;
  fill: ${theme.common.fg.hex()};

  :hover {
    fill: ${theme.common.fg.brighten(1.5).hex()};
  }
`;
