import { requireNode } from '@cocoon/shared/graph';
import {
  deserialiseNode,
  registerSyncNode,
  registerUpdateNodeProgress,
  sendClearPersistedCache,
  sendCreateView,
  sendFocusNode,
  sendProcessNode,
  sendRemoveNode,
  sendRemoveView,
  sendRequestNodeSync,
  sendRunProcess,
  sendSyncNode,
  serialiseNode,
  unregisterSyncNode,
  unregisterUpdateNodeProgress,
} from '@cocoon/shared/ipc';
import { Graph, GraphNode, NodeStatus } from '@cocoon/types';
import _ from 'lodash';
import React, { useContext, useEffect, useReducer, useRef } from 'react';
import { DraggableCore, DraggableEventHandler } from 'react-draggable';
import styled from 'styled-components';
import { createViewTypeMenuTemplate, MenuItemType } from './ContextMenu';
import { EditorContext } from './Editor';
import { EditorNodeEdge } from './EditorNodeEdge';
import { EditorNodePort } from './EditorNodePort';
import { EditorNodeSummary } from './EditorNodeSummary';
import { PositionData } from './layout';
import { theme } from './theme';
import { Tooltip } from './Tooltip';

export interface EditorNodeProps {
  node: GraphNode;
  graph: Graph;
  positions: PositionData;
  dragGrid: [number, number];
  onDrag: (deltaX: number, deltaY: number) => void;
  onDrop: () => void;
}

export const EditorNode = (props: EditorNodeProps) => {
  const { node, graph, positions, dragGrid, onDrag, onDrop } = props;
  const nodeRef = useRef<SVGCircleElement>();
  const [_0, forceUpdate] = useReducer(x => x + 1, 0);
  const editorContext = useContext(EditorContext)!;

  useEffect(() => {
    const syncHandler = registerSyncNode(props.node.id, args => {
      if (node.state.error) {
        console.error(node.state.error);
      }
      _.assign(node, deserialiseNode(args.serialisedNode));
      forceUpdate(0);
    });
    const progressHandler = registerUpdateNodeProgress(props.node.id, args => {
      if (args.summary) {
        props.node.state.summary = args.summary;
        forceUpdate(0);
      }
    });
    // Once mounted we send a sync request. Normally this is unnecessary since
    // we should already have the up-to-date data, but in the time between
    // mounting the Editor component and creating the EditorNode components the
    // Cocoon process might have sent node syncs that were lost.
    //
    // By attaching the synchronisation id the Cocoon process can figure out if
    // a sync was lost and re-send it.
    sendRequestNodeSync({
      nodeId: node.id,
      syncId: node.syncId,
    });
    return () => {
      unregisterSyncNode(node.id, syncHandler);
      unregisterUpdateNodeProgress(node.id, progressHandler);
    };
  }, [node]);

  const onDragMove: DraggableEventHandler = (event, data) => {
    onDrag(data.deltaX, data.deltaY);
  };

  const onDragStop: DraggableEventHandler = (event, data) => {
    // Only trigger if we actually dragged
    if (data.deltaX || data.deltaY) {
      onDrop();
    }
  };

  const toggleHot = () => {
    node.hot = !node.hot;
    sendSyncNode({ serialisedNode: serialiseNode(node) });
    sendProcessNode({ nodeId: node.id });
  };

  const togglePersist = () => {
    node.definition.persist = !node.definition.persist;
    sendSyncNode({ serialisedNode: serialiseNode(node) });
  };

  const createContextMenuForNode = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const { editor, persist } = node.definition;
    const actions = editor && editor.actions ? Object.keys(editor.actions) : [];
    editorContext.contextMenu.current!.create(
      editorContext.translatePosition({
        x: event.clientX,
        y: event.clientY,
      }),
      [
        {
          checked: persist === true,
          click: togglePersist,
          label: 'Persist',
          type: MenuItemType.Checkbox,
        },
        {
          checked: node.hot === true,
          click: toggleHot,
          label: 'Hot',
          type: MenuItemType.Checkbox,
        },
        {
          label: node.view === undefined ? 'Create View' : 'Change View',
          submenu: createViewTypeMenuTemplate(
            editorContext.registry!,
            selectedViewType => {
              sendCreateView({
                nodeId: node.id,
                type: selectedViewType,
              });
            }
          ),
        },
        {
          click: () => {
            sendClearPersistedCache({ nodeId: node.id });
          },
          label: 'Clear persisted cache',
        },
        node.view !== undefined && {
          click: () => {
            sendRemoveView({ nodeId: node.id });
          },
          label: 'Remove View',
        },
        actions.length > 0 ? { type: MenuItemType.Separator } : null,
        ...actions.map(action => ({
          click: () => {
            sendRunProcess({
              command: editor!.actions![action],
            });
          },
          label: action,
        })),
        { type: MenuItemType.Separator },
        {
          click: () => {
            sendRemoveNode({ nodeId: node.id });
          },
          label: 'Remove',
        },
      ]
    );
  };

  const { status, summary, error } = node.state;
  const tooltip = error
    ? error.message || error.toString()
    : node.definition['?']
    ? node.definition['?']
    : summary
    ? summary
    : node.cocoonNode
    ? node.cocoonNode.description
    : '';
  const pos = positions.nodes[node.id];
  const statusClass =
    status === NodeStatus.error
      ? 'error'
      : status === NodeStatus.processed
      ? 'processed'
      : status === NodeStatus.processing
      ? 'processing'
      : node.state.scheduled
      ? 'scheduled'
      : undefined;
  return (
    <DraggableCore
      handle=".EditorNode__draggable"
      grid={dragGrid}
      onDrag={onDragMove}
      onStop={onDragStop}
    >
      <Wrapper className={statusClass}>
        <Draggable className="EditorNode__draggable">
          <text
            x={pos.glyph.x}
            y={pos.glyph.y - 45}
            onClick={() => sendFocusNode({ nodeId: node.id })}
            onContextMenu={createContextMenuForNode}
          >
            {node.definition.type}
          </text>
          <Id
            x={pos.glyph.x}
            y={pos.glyph.y - 28}
            onClick={() => sendFocusNode({ nodeId: node.id })}
            onContextMenu={createContextMenuForNode}
          >
            {node.id}
          </Id>
        </Draggable>
        <Tooltip text={tooltip}>
          <Glyph
            ref={nodeRef as any}
            className={node.hot ? 'hot' : undefined}
            cx={pos.glyph.x}
            cy={pos.glyph.y}
            r="15"
            onClick={event => {
              if (event.metaKey) {
                toggleHot();
              } else {
                sendProcessNode({ nodeId: node.id });
              }
            }}
            onContextMenu={createContextMenuForNode}
            style={{
              // Necessary for transforming the glyph, since SVG transforms are
              // relative to the SVG canvas
              transformOrigin: `${pos.glyph.x}px ${pos.glyph.y}px`,
            }}
          />
        </Tooltip>

        <EditorNodeSummary
          error={error}
          height={pos.overlay.height}
          node={node}
          width={pos.overlay.width}
          x={pos.overlay.x}
          y={pos.overlay.y}
        />
        <g>
          {pos.ports.in.map(({ name, x, y }, i) => (
            <EditorNodePort
              incoming={true}
              key={name}
              port={name}
              node={node}
              positionX={x}
              positionY={y}
              size={3}
            />
          ))}
        </g>
        <g>
          {pos.ports.out.map(({ name, x, y }, i) => (
            <EditorNodePort
              incoming={false}
              key={name}
              port={name}
              node={node}
              positionX={x}
              positionY={y}
              size={3}
            />
          ))}
        </g>
        <g>
          {node.edgesOut.map(edge => {
            const posFrom = pos.ports.out.find(x => x.name === edge.fromPort)!;
            const posTo = positions.nodes[edge.to].ports.in.find(
              x => x.name === edge.toPort
            )!;
            const fromStats = requireNode(edge.from, graph).state.portStats;
            return (
              <EditorNodeEdge
                key={`${edge.to}/${edge.toPort}`}
                fromX={posFrom.x}
                fromY={posFrom.y}
                toX={posTo.x}
                toY={posTo.y}
                count={
                  fromStats !== undefined &&
                  fromStats[edge.fromPort] !== undefined
                    ? fromStats[edge.fromPort].itemCount
                    : null
                }
              />
            );
          })}
        </g>
      </Wrapper>
    </DraggableCore>
  );
};

const Glyph = styled.circle`
  fill: ${theme.common.fg.hex()};

  &.hot {
    transform-origin: center;
    animation: pulsate 1.5s cubic-bezier(0.5, 0, 0.5, 1);
    animation-iteration-count: infinite;
  }

  &:hover {
    fill: ${theme.common.fg.brighten(1.5).hex()};
  }

  @keyframes pulsate {
    0% {
      transform: scale(1, 1);
    }
    50% {
      transform: scale(1.2, 1.2);
    }
    100% {
      transform: scale(1, 1);
    }
  }
`;

const Wrapper = styled.g`
  & text {
    fill: ${theme.common.fg.hex()};
    text-anchor: middle;
    user-select: none;
  }
  &.error ${Glyph}, &.error text {
    fill: ${theme.syntax.error.hex()};
  }
  &.error ${Glyph}:hover {
    fill: ${theme.syntax.error.brighten(1.5).hex()};
  }
  &.processed ${Glyph}, &.processed text {
    fill: ${theme.syntax.string.hex()};
  }
  &.processed ${Glyph}:hover {
    fill: ${theme.syntax.string.brighten(1.5).hex()};
  }
  &.processing ${Glyph}, &.processing text {
    fill: ${theme.syntax.func.hex()};
  }
  &.processing ${Glyph}:hover {
    fill: ${theme.syntax.func.brighten(1.5).hex()};
  }
  &.scheduled ${Glyph}, &.scheduled text {
    fill: ${theme.syntax.entity.hex()};
  }
  &.scheduled ${Glyph}:hover {
    fill: ${theme.syntax.entity.brighten(1.5).hex()};
  }
`;

const Draggable = styled.g`
  cursor: move;
`;

const Id = styled.text`
  font-size: var(--font-size-small);
  opacity: 0.6;
`;
