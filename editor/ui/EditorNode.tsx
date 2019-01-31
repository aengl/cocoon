import React from 'react';
import { DraggableCore, DraggableEventHandler } from 'react-draggable';
import styled from 'styled-components';
import {
  createEdgesForNode,
  Graph,
  GraphNode,
  NodeStatus,
} from '../../common/graph';
import {
  registerNodeProgress,
  registerNodeSync,
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
import { NodeObject } from '../../common/node';
import {
  createContextMenu,
  createViewTypeMenuTemplate,
  MenuItemType,
} from './ContextMenu';
import { DataView } from './DataView';
import { EditorNodeEdge } from './EditorNodeEdge';
import { EditorNodePort } from './EditorNodePort';
import { translate } from './svg';
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

export interface EditorNodeState {}

export interface PositionData {
  [nodeId: string]: {
    node: ReturnType<typeof calculateNodePosition>;
    overlay: ReturnType<typeof calculateOverlayBounds>;
    ports: ReturnType<typeof calculatePortPositions>;
  };
}

export class EditorNode extends React.Component<
  EditorNodeProps,
  EditorNodeState
> {
  sync: ReturnType<typeof registerNodeSync>;
  progress: ReturnType<typeof registerNodeProgress>;
  nodeRef: React.RefObject<SVGCircleElement>;

  constructor(props) {
    super(props);
    this.nodeRef = React.createRef();
    this.sync = registerNodeSync(props.node.id, args => {
      const { node, graph } = this.props;
      updateNode(node, args.serialisedNode);
      createEdgesForNode(node, graph);
      const { status, summary, error } = node.state;
      if (status === NodeStatus.error && error !== undefined) {
        console.error(error);
        showTooltip(this.nodeRef.current, error.message);
      } else if (summary !== undefined) {
        showTooltip(this.nodeRef.current, summary);
      } else {
        removeTooltip(this.nodeRef.current);
      }
      this.forceUpdate();
    });
    this.progress = registerNodeProgress(props.node.id, args => {
      this.props.node.state.summary = args.summary;
      this.forceUpdate();
    });
  }

  onDragMove: DraggableEventHandler = (event, data) => {
    const { onDrag } = this.props;
    onDrag(data.deltaX, data.deltaY);
  };

  onDragStop: DraggableEventHandler = (event, data) => {
    // Only trigger if we actually dragged
    if (data.deltaX || data.deltaY) {
      const { onDrop } = this.props;
      onDrop();
    }
  };

  createContextMenuForNode = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const { node } = this.props;
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
          checked: node.hot === true,
          click: this.toggleHot,
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
        {
          type: MenuItemType.Separator,
        },
        {
          click: () => {
            sendRemoveNode({ nodeId: node.id });
          },
          label: 'Remove',
        },
      ]
    );
  };

  toggleHot = () => {
    const { node } = this.props;
    node.hot = !node.hot;
    sendNodeSync({ serialisedNode: serialiseNode(node) });
    sendProcessNode({ nodeId: node.id });
  };

  componentWillUnmount() {
    const { node } = this.props;
    unregisterNodeSync(node.id, this.sync);
    unregisterNodeProgress(node.id, this.progress);
  }

  componentDidMount() {
    const { node } = this.props;
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
  }

  render() {
    const { positionData, dragGrid } = this.props;
    const { node } = this.props;
    const { status, summary, error, viewData } = node.state;
    const pos = positionData[node.id];
    const statusClass =
      status === NodeStatus.cached
        ? 'cached'
        : status === NodeStatus.error
        ? 'error'
        : status === NodeStatus.processed
        ? 'processed'
        : status === NodeStatus.processing
        ? 'processing'
        : undefined;
    const errorOrSummary = error ? error.message : summary;
    const showView =
      node.view !== undefined && node.state.viewData !== undefined;
    return (
      <DraggableCore
        handle=".EditorNode__draggable"
        grid={dragGrid}
        onDrag={this.onDragMove}
        onStop={this.onDragStop}
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
            ref={this.nodeRef}
            className={node.hot ? 'hot' : undefined}
            cx={pos.node.x}
            cy={pos.node.y}
            r="15"
            onClick={event => {
              if (event.metaKey) {
                this.toggleHot();
              } else {
                sendProcessNode({ nodeId: node.id });
              }
            }}
            onContextMenu={this.createContextMenuForNode}
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
                position={{ x, y }}
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
                position={{ x, y }}
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
              />
            </div>
          </foreignObject>
          <g>
            {node.edgesOut.map(edge => {
              const posFrom = pos.ports.out.find(
                x => x.name === edge.fromPort
              )!;
              const posTo = positionData[edge.to.id].ports.in.find(
                x => x.name === edge.toPort
              )!;
              return (
                <EditorNodeEdge
                  key={`${edge.to.id}/${edge.toPort}`}
                  from={posFrom}
                  to={posTo}
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
  }
}

export function calculateNodePosition(
  gridX: number,
  gridY: number,
  gridWidth: number,
  gridHeight: number
) {
  const tx = translate(gridX * gridWidth);
  const ty = translate(gridY * gridHeight);
  return { x: tx(gridWidth / 2), y: ty(gridHeight / 4) + 20 };
}

export function calculateOverlayBounds(
  gridX: number,
  gridY: number,
  gridWidth: number,
  gridHeight: number
) {
  const tx = translate(gridX * gridWidth);
  const ty = translate(gridY * gridHeight);
  return {
    height: gridHeight / 2,
    width: gridWidth,
    x: tx(0),
    y: ty(gridHeight / 2),
  };
}

export function calculatePortPositions(
  nodeObj: NodeObject,
  nodeX: number,
  nodeY: number
) {
  const inPorts = nodeObj.in ? Object.keys(nodeObj.in) : [];
  const outPorts = nodeObj.out ? Object.keys(nodeObj.out) : [];
  const offsetX = 22;
  const availableHeight = 50;
  const inStep = 1 / (inPorts.length + 1);
  const outStep = 1 / (outPorts.length + 1);
  const tx = translate(nodeX);
  const ty = translate(nodeY);
  return {
    in: inPorts.map((port, i) => {
      const y = (i + 1) * inStep;
      return {
        name: port,
        x: tx(-offsetX + Math.cos(y * 2 * Math.PI) * 3),
        y: ty(y * availableHeight - availableHeight / 2),
      };
    }),
    out: outPorts.map((port, i) => {
      const y = (i + 1) * outStep;
      return {
        name: port,
        x: tx(offsetX - Math.cos(y * 2 * Math.PI) * 3),
        y: ty(y * availableHeight - availableHeight / 2),
      };
    }),
  };
}

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
