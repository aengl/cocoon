import classNames from 'classnames';
import React from 'react';
import { DraggableCore, DraggableData } from 'react-draggable';
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
  sendEvaluateNode,
  sendNodeSync,
  sendRemoveNode,
  sendRemoveView,
  serialiseNode,
  unregisterNodeProgress,
  unregisterNodeSync,
  updateNode,
} from '../../common/ipc';
import { getNode } from '../../core/nodes';
import { DataView } from './DataView';
import { EditorNodeEdge } from './EditorNodeEdge';
import { EditorNodePort } from './EditorNodePort';
import { createMenuFromTemplate, createViewTypeMenuTemplate } from './menus';
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

  onDragMove = (e: MouseEvent, data: DraggableData) => {
    const { onDrag } = this.props;
    onDrag(data.deltaX, data.deltaY);
  };

  onDragStop = (e: MouseEvent, data: DraggableData) => {
    // Only trigger if we actually dragged
    if (data.deltaX || data.deltaY) {
      const { onDrop } = this.props;
      onDrop();
    }
  };

  createContextMenuForNode = () => {
    const { node } = this.props;
    createMenuFromTemplate([
      {
        checked: node.hot === true,
        click: this.toggleHot,
        label: 'Hot',
        type: 'checkbox',
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
      {
        type: 'separator',
      },
      {
        click: () => {
          sendRemoveNode({ nodeId: node.id });
        },
        label: 'Remove',
      },
    ]);
  };

  toggleHot = () => {
    const { node } = this.props;
    node.hot = !node.hot;
    sendNodeSync({ serialisedNode: serialiseNode(node) });
    sendEvaluateNode({ nodeId: node.id });
  };

  componentWillUnmount() {
    const { node } = this.props;
    unregisterNodeSync(node.id, this.sync);
    unregisterNodeProgress(node.id, this.progress);
  }

  render() {
    const { positionData, dragGrid } = this.props;
    const { node } = this.props;
    const { status, summary, error, viewData } = node.state;
    const pos = positionData[node.id];
    const nodeClass = classNames('EditorNode', {
      'EditorNode--cached': status === NodeStatus.cached,
      'EditorNode--error': status === NodeStatus.error,
      'EditorNode--processed': status === NodeStatus.processed,
      'EditorNode--processing': status === NodeStatus.processing,
    });
    const glyphClass = classNames('EditorNode__glyph', {
      'EditorNode__glyph--hot': node.hot,
    });
    const errorOrSummary = error ? error.message : summary;
    const showView = node.view !== undefined;
    return (
      <DraggableCore
        handle=".EditorNode__draggable"
        grid={dragGrid}
        onDrag={this.onDragMove}
        onStop={this.onDragStop}
      >
        <g className={nodeClass}>
          <g className="EditorNode__draggable">
            <text
              className="EditorNode__type"
              x={pos.node.x}
              y={pos.node.y - 45}
            >
              {node.type}
            </text>
            <text className="EditorNode__id" x={pos.node.x} y={pos.node.y - 28}>
              {node.id}
            </text>
          </g>
          <circle
            ref={this.nodeRef}
            className={glyphClass}
            cx={pos.node.x}
            cy={pos.node.y}
            r="15"
            onClick={event => {
              if (event.metaKey) {
                this.toggleHot();
              } else {
                sendEvaluateNode({ nodeId: node.id });
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
              className="EditorNode__summary"
              x={pos.overlay.x}
              y={pos.overlay.y}
              width={pos.overlay.width}
              height={pos.overlay.height}
            >
              <p>{errorOrSummary}</p>
            </foreignObject>
          ) : null}
          <g className="EditorNode__inPorts">
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
          <g className="EditorNode__outPorts">
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
          {showView && (
            <foreignObject
              x={pos.overlay.x}
              y={pos.overlay.y}
              width={pos.overlay.width}
              height={pos.overlay.height}
            >
              <DataView
                node={node}
                width={pos.overlay.width}
                height={pos.overlay.height}
                isPreview={true}
              />
            </foreignObject>
          )}
          <g className="EditorNode__edges">
            {node.edgesIn.map(edge => {
              const posFrom = positionData[edge.from.id].ports.out.find(
                x => x.name === edge.fromPort
              )!;
              const posTo = pos.ports.in.find(x => x.name === edge.toPort)!;
              return (
                <EditorNodeEdge
                  key={edge.toPort}
                  from={posFrom}
                  to={posTo}
                  count={
                    status !== undefined &&
                    edge.from.state.portStats !== undefined
                      ? edge.from.state.portStats[edge.fromPort].itemCount
                      : null
                  }
                />
              );
            })}
          </g>
        </g>
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
  node: GraphNode,
  nodeX: number,
  nodeY: number
) {
  const nodeObj = getNode(node.type);
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
