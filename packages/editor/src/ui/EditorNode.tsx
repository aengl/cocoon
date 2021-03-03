import { Graph, GraphNode, NodeStatus } from '@cocoon/types';
import clearPersistedCache from '@cocoon/util/ipc/clearPersistedCache';
import createView from '@cocoon/util/ipc/createView';
import focusNode from '@cocoon/util/ipc/focusNode';
import processNode from '@cocoon/util/ipc/processNode';
import removeNode from '@cocoon/util/ipc/removeNode';
import removeView from '@cocoon/util/ipc/removeView';
import requestNodeSync from '@cocoon/util/ipc/requestNodeSync';
import runProcess from '@cocoon/util/ipc/runProcess';
import syncNode from '@cocoon/util/ipc/syncNode';
import updateNodeProgress from '@cocoon/util/ipc/updateNodeProgress';
import requireGraphNode from '@cocoon/util/requireGraphNode';
import _ from 'lodash';
import React, { useContext, useEffect, useReducer, useRef } from 'react';
import { DraggableCore, DraggableEventHandler } from 'react-draggable';
import { createViewTypeMenuTemplate, MenuItemType } from './ContextMenu';
import { openDataViewWindow } from './DataViewWindow';
import { EditorContext } from './Editor';
import { EditorNodeEdge } from './EditorNodeEdge';
import { EditorNodePort } from './EditorNodePort';
import { EditorNodeSummary } from './EditorNodeSummary';
import { ErrorPage } from './ErrorPage';
import { deserialiseNode, ipcContext, serialiseNode } from './ipc';
import { PositionData } from './layout';
import { theme } from './theme';
import { Tooltip } from './Tooltip';

const debug = require('debug')('ui:EditorNode');

export interface EditorNodeProps {
  node: GraphNode;
  graph: Graph;
  positions: PositionData;
  dragGrid: [number, number];
  onDrag: (deltaX: number, deltaY: number) => void;
  onDrop: () => void;
}

export const EditorNode = (props: EditorNodeProps) => {
  const ipc = ipcContext();

  const { node, graph, positions, dragGrid, onDrag, onDrop } = props;
  const nodeRef = useRef<SVGCircleElement>();
  const [_0, forceUpdate] = useReducer(x => x + 1, 0);
  const editorContext = useContext(EditorContext)!;

  useEffect(() => {
    const syncHandler = syncNode.register(ipc, props.node.id, args => {
      if (node.state.error) {
        console.error(node.state.error);
      }
      _.assign(node, deserialiseNode(args.serialisedNode));
      forceUpdate();
    });
    const progressHandler = updateNodeProgress.register(
      ipc,
      props.node.id,
      args => {
        if (args.summary) {
          props.node.state.summary = args.summary;
          forceUpdate();
        }
      }
    );
    // Once mounted we send a sync request. Normally this is unnecessary since
    // we should already have the up-to-date data, but in the time between
    // mounting the Editor component and creating the EditorNode components the
    // Cocoon process might have sent node syncs that were lost.
    //
    // By attaching the synchronisation id the Cocoon process can figure out if
    // a sync was lost and re-send it.
    requestNodeSync(ipc, {
      nodeId: node.id,
      syncId: node.syncId,
    });
    return () => {
      syncNode.unregister(ipc, node.id, syncHandler);
      updateNodeProgress.unregister(ipc, node.id, progressHandler);
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
    syncNode.send(ipc, { serialisedNode: serialiseNode(node) });
    processNode(ipc, { nodeId: node.id });
  };

  const togglePersist = () => {
    node.definition.persist = !node.definition.persist;
    syncNode.send(ipc, { serialisedNode: serialiseNode(node) });
  };

  const createContextMenuForNode = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const { editor, persist } = node.definition;
    const mergedActions = {
      ...(node.cocoonNode!.defaultActions || {}),
      ...((editor && editor.actions) || {}),
    };
    const actions = Object.keys(mergedActions)
      .map(actionName => [
        actionName,
        // Actions can interpolate from port values
        interpolateTemplate(mergedActions[actionName], {
          // Collect default values for all ports
          ...(node.cocoonNode!.in
            ? Object.keys(node.cocoonNode!.in).reduce((acc, port) => {
                acc[port] = node.cocoonNode!.in![port].defaultValue;
                return acc;
              }, {})
            : {}),
          // Override with port values from definitions
          ...node.definition.in,
        }),
      ])
      .filter((x): x is [string, string] => Boolean(x[1]));
    editorContext.contextMenu.current!.create(
      {
        x: event.clientX,
        y: event.clientY,
      },
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
        node.view !== undefined && {
          click: () => openDataViewWindow(node),
          label: 'Open View',
        },
        {
          label: node.view === undefined ? 'Create View' : 'Change View',
          submenu: createViewTypeMenuTemplate(
            editorContext.registry!,
            selectedViewType => {
              createView(ipc, {
                nodeId: node.id,
                type: selectedViewType,
              });
            }
          ),
        },
        {
          click: () => {
            clearPersistedCache(ipc, { nodeId: node.id });
          },
          label: 'Clear persisted cache',
        },
        node.view !== undefined && {
          click: () => {
            removeView(ipc, { nodeId: node.id });
          },
          label: 'Remove View',
        },
        actions.length > 0 ? { type: MenuItemType.Separator } : null,
        ...actions.map(x => ({
          click: () => {
            runProcess(ipc, {
              command: x[1],
            });
          },
          label: x[0],
        })),
        { type: MenuItemType.Separator },
        {
          click: () => {
            removeNode(ipc, { nodeId: node.id });
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
      : status === NodeStatus.processing || status === NodeStatus.restoring
      ? 'processing'
      : node.state.scheduled
      ? 'scheduled'
      : undefined;
  try {
    return (
      <DraggableCore
        handle=".EditorNode__draggable"
        grid={dragGrid}
        onDrag={onDragMove}
        onStop={onDragStop}
      >
        <g className={`wrapper ${statusClass}`}>
          <g className="EditorNode__draggable">
            <text
              className="text-type"
              x={pos.glyph.x}
              y={pos.glyph.y - 45}
              onClick={() => focusNode.send(ipc, { nodeId: node.id })}
              onContextMenu={createContextMenuForNode}
            >
              {node.definition.type}
            </text>
            <text
              className="text-id"
              x={pos.glyph.x}
              y={pos.glyph.y - 28}
              onClick={() => focusNode.send(ipc, { nodeId: node.id })}
              onContextMenu={createContextMenuForNode}
            >
              {node.id}
            </text>
          </g>
          <Tooltip text={tooltip}>
            <circle
              ref={nodeRef as any}
              className={node.hot ? 'hot' : undefined}
              cx={pos.glyph.x}
              cy={pos.glyph.y}
              r="15"
              onClick={event => {
                if (event.metaKey) {
                  toggleHot();
                } else {
                  processNode(ipc, { nodeId: node.id });
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
              const posFrom = pos.ports.out.find(
                x => x.name === edge.fromPort
              )!;
              const posTo = positions.nodes[edge.to].ports.in.find(
                x => x.name === edge.toPort
              )!;
              const fromStats = requireGraphNode(edge.from, graph).state
                .portStats;
              if (!posTo) {
                throw new Error(
                  `failed to connect to ${edge.to}/${edge.toPort}`
                );
              }
              return (
                <EditorNodeEdge
                  key={`${edge.from}/${edge.fromPort}->${edge.to}/${edge.toPort}`}
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
          <style jsx>{`
            text {
              fill: ${theme.common.fg.hex()};
              text-anchor: middle;
              user-select: none;
              cursor: pointer;
            }
            .text-id {
              font-size: var(--font-size-small);
              opacity: 0.6;
            }
            .error circle {
              fill: ${theme.syntax.error.hex()};
            }
            .error circle:hover {
              fill: ${theme.syntax.error.brighten(1.5).hex()};
            }
            .processed circle {
              fill: ${theme.syntax.string.hex()};
            }
            .processed circle:hover {
              fill: ${theme.syntax.string.brighten(1.5).hex()};
            }
            .processing circle {
              fill: ${theme.syntax.func.hex()};
            }
            .processing circle:hover {
              fill: ${theme.syntax.func.brighten(1.5).hex()};
            }
            .scheduled circle {
              fill: ${theme.syntax.entity.hex()};
            }
            .scheduled circle:hover {
              fill: ${theme.syntax.entity.brighten(1.5).hex()};
            }
            .EditorNode__draggable {
              cursor: move;
            }
            circle {
              fill: ${theme.common.fg.hex()};
            }
            circle.hot {
              transform-origin: center;
              animation: pulsate 1.5s cubic-bezier(0.5, 0, 0.5, 1);
              animation-iteration-count: infinite;
            }
            circle:hover {
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
          `}</style>
        </g>
      </DraggableCore>
    );
  } catch (error) {
    console.error(error);
    return (
      <g>
        <text
          className="text-type"
          x={pos.glyph.x}
          y={pos.glyph.y - 45}
          onClick={() => focusNode.send(ipc, { nodeId: node.id })}
          onContextMenu={createContextMenuForNode}
        >
          {node.definition.type}
        </text>
        <text
          className="text-id"
          x={pos.glyph.x}
          y={pos.glyph.y - 28}
          onClick={() => focusNode.send(ipc, { nodeId: node.id })}
          onContextMenu={createContextMenuForNode}
        >
          {node.id}
        </text>
        <circle cx={pos.glyph.x} cy={pos.glyph.y} r="15" />
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
        <foreignObject
          x={pos.overlay.x}
          y={pos.overlay.y}
          width={pos.overlay.width}
          height={pos.overlay.height}
        >
          <ErrorPage compact error={error}></ErrorPage>
        </foreignObject>
        <style jsx>{`
          text {
            fill: ${theme.common.fg.hex()};
            text-anchor: middle;
            user-select: none;
            cursor: pointer;
          }
          .text-id {
            font-size: var(--font-size-small);
            opacity: 0.6;
          }
          circle {
            fill: ${theme.syntax.error.hex()};
          }
          circle:hover {
            fill: ${theme.syntax.error.brighten(1.5).hex()};
          }
        `}</style>
      </g>
    );
  }
};

// https://stackoverflow.com/questions/30003353/
const interpolateTemplate = (templateString, templateVars) => {
  try {
    return new Function(`return \`${templateString}\`;`).call(templateVars);
  } catch (error) {
    debug(error);
    return false;
  }
};
