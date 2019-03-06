import React, { useEffect, useRef, useState } from 'react';
import { DraggableCore, DraggableEventHandler } from 'react-draggable';
import styled from 'styled-components';
import {
  createEdgesForNode,
  Graph,
  GraphNode,
  GraphNodeState,
  nodeIsCached,
  NodeStatus,
} from '../../common/graph';
import {
  registerNodeProgress,
  registerNodeSync,
  sendClearPersistedCache,
  sendCreateView,
  sendNodeSync,
  sendProcessNode,
  sendRemoveNode,
  sendRemoveView,
  sendRequestNodeSync,
  sendRunProcess,
  serialiseNode,
  unregisterNodeProgress,
  unregisterNodeSync,
  updateNode,
} from '../../common/ipc';
import {
  createContextMenu,
  createViewTypeMenuTemplate,
  MenuItemType,
} from './ContextMenu';
import { DataView } from './DataView';
import { EditorNodeEdge } from './EditorNodeEdge';
import { EditorNodePort } from './EditorNodePort';
import { PositionData } from './layout';
import { removeTooltip, showTooltip } from './tooltips';

const debug = require('../../common/debug')('editor:EditorNode');

export interface EditorNodeProps {
  node: GraphNode;
  graph: Graph;
  positionData: PositionData;
  dragGrid: [number, number];
  onDrag: (deltaX: number, deltaY: number) => void;
  onDrop: () => void;
}

export const EditorNode = (props: EditorNodeProps) => {
  const { node, graph, positionData, dragGrid, onDrag, onDrop } = props;
  const nodeRef = useRef<SVGCircleElement>();
  const [nodeState, setNodeState] = useState<GraphNodeState>(node.state);

  useEffect(() => {
    const syncHandler = registerNodeSync(props.node.id, args => {
      updateNode(node, args.serialisedNode);
      createEdgesForNode(node, graph);
      if (
        node.state.status === NodeStatus.error &&
        node.state.error !== undefined
      ) {
        console.error(node.state.error.message, node.state.error);
        showTooltip(nodeRef.current, node.state.error.message);
      } else if (node.state.summary !== undefined) {
        showTooltip(nodeRef.current, node.state.summary);
      } else {
        removeTooltip(nodeRef.current);
      }
      setNodeState(node.state);
    });
    const progressHandler = registerNodeProgress(props.node.id, args => {
      props.node.state.summary = args.summary;
      setNodeState(node.state);
    });
    // Once mounted we send a sync request. Normally this is unnecessary since
    // we should already have the up-to-date data, but in the time between
    // mounting the Editor component and creating the EditorNode components the
    // core process might have sent node syncs that were lost.
    //
    // By attaching the synchronisation id the core process can figure out if a
    // sync was lost and re-send it.
    sendRequestNodeSync({
      nodeId: node.id,
      syncId: node.syncId,
    });
    return () => {
      unregisterNodeSync(node.id, syncHandler);
      unregisterNodeProgress(node.id, progressHandler);
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
    sendNodeSync({ serialisedNode: serialiseNode(node) });
    sendProcessNode({ nodeId: node.id });
  };

  const togglePersist = () => {
    node.definition.persist = !node.definition.persist;
    sendNodeSync({ serialisedNode: serialiseNode(node) });
  };

  const createContextMenuForNode = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const actions =
      node.definition.actions === undefined
        ? []
        : Object.keys(node.definition.actions);
    createContextMenu(
      {
        x: event.pageX,
        y: event.pageY,
      },
      [
        {
          checked: node.definition.persist === true,
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
          submenu: createViewTypeMenuTemplate(selectedViewType => {
            if (selectedViewType !== undefined) {
              sendCreateView({
                nodeId: node.id,
                type: selectedViewType,
              });
            }
          }),
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
        ...actions.map(action => ({
          click: () => {
            sendRunProcess({
              command: node.definition.actions![action],
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

  const { status, summary, error, viewData } = nodeState;
  const pos = positionData[node.id];
  const statusClass = nodeIsCached(node)
    ? 'cached'
    : status === NodeStatus.error
    ? 'error'
    : status === NodeStatus.processed
    ? 'processed'
    : status === NodeStatus.processing
    ? 'processing'
    : undefined;
  const errorOrSummary = error ? error.message : summary;
  const showView = node.view !== undefined && viewData !== undefined;
  return (
    <DraggableCore
      handle=".EditorNode__draggable"
      grid={dragGrid}
      onDrag={onDragMove}
      onStop={onDragStop}
    >
      <Wrapper className={statusClass}>
        <Draggable className="EditorNode__draggable">
          <text x={pos.node.x} y={pos.node.y - 45}>
            {node.definition.type}
          </text>
          <Id x={pos.node.x} y={pos.node.y - 28}>
            {node.id}
          </Id>
        </Draggable>
        <Glyph
          ref={nodeRef as any}
          className={node.hot ? 'hot' : undefined}
          cx={pos.node.x}
          cy={pos.node.y}
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
            transformOrigin: `${pos.node.x}px ${pos.node.y}px`,
          }}
        />
        {errorOrSummary && !showView ? (
          <foreignObject
            x={pos.overlay.x}
            y={pos.overlay.y}
            width={pos.overlay.width}
            height={pos.overlay.height}
          >
            <Summary>{errorOrSummary}</Summary>
          </foreignObject>
        ) : null}
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
        <foreignObject
          x={pos.overlay.x}
          y={pos.overlay.y}
          width={pos.overlay.width}
          height={pos.overlay.height}
        >
          <div
            style={{
              visibility: showView ? 'visible' : 'hidden',
            }}
          >
            <DataView
              node={node}
              width={pos.overlay.width}
              height={pos.overlay.height}
              isPreview={true}
              viewDataId={nodeState.viewDataId}
            />
          </div>
        </foreignObject>
        <g>
          {node.edgesOut.map(edge => {
            const posFrom = pos.ports.out.find(x => x.name === edge.fromPort)!;
            const posTo = positionData[edge.to.id].ports.in.find(
              x => x.name === edge.toPort
            )!;
            return (
              <EditorNodeEdge
                key={`${edge.to.id}/${edge.toPort}`}
                fromX={posFrom.x}
                fromY={posFrom.y}
                toX={posTo.x}
                toY={posTo.y}
                count={
                  edge.from.state.portStats !== undefined &&
                  edge.from.state.portStats[edge.fromPort] !== undefined
                    ? edge.from.state.portStats[edge.fromPort].itemCount
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
  fill: var(--color-foreground);

  &.hot {
    transform-origin: center;
    animation: pulsate 1.5s cubic-bezier(0.5, 0, 0.5, 1);
    animation-iteration-count: infinite;
  }

  &:hover {
    fill: var(--color-highlight);
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
    fill: var(--color-foreground);
    text-anchor: middle;
    user-select: none;
  }
  &.cached ${Glyph}, &.cached text {
    fill: var(--color-orange);
  }
  &.error ${Glyph}, &.error text {
    fill: var(--color-red);
  }
  &.processed ${Glyph}, &.processed text {
    fill: var(--color-green);
  }
  &.processing ${Glyph}, &.processing text {
    fill: var(--color-purple);
  }
`;

const Draggable = styled.g`
  cursor: move;
`;

const Id = styled.text`
  font-size: var(--font-size-small);
  opacity: 0.6;
`;

const Summary = styled.p`
  font-size: var(--font-size-small);
  text-align: center;
  opacity: 0.6;
  padding: 0 5px;
  margin: 0;
`;
