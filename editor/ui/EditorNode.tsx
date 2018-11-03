import classNames from 'classnames';
import electron from 'electron';
import React from 'react';
import { DraggableCore } from 'react-draggable';
import {
  getUpdatedNode,
  registerNodeProgress,
  registerNodeSync,
  sendEvaluateNode,
  sendNodeSync,
  sendPortDataRequest,
  serialiseNode,
  unregisterNodeProgress,
  unregisterNodeSync,
} from '../../common/ipc';
import { CocoonNode, NodeStatus } from '../../common/node';
import { getNode } from '../../core/nodes';
import { DataView } from './DataView';
import { EditorNodeEdge } from './EditorNodeEdge';
import { EditorNodePort } from './EditorNodePort';
import { translate } from './svg';
import { removeTooltip, showTooltip } from './tooltips';

const debug = require('../../common/debug')('editor:EditorNode');
const remote = electron.remote;

export interface EditorNodeProps {
  node: CocoonNode;
  positionData: PositionData;
  dragGrid: [number, number];
  onDrag: (deltaX: number, deltaY: number) => void;
  onDrop: () => void;
}

export interface EditorNodeState {
  node: CocoonNode;
}

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
    const { node } = this.props;
    this.state = { node };
    this.onDragMove = this.onDragMove.bind(this);
    this.onDragStop = this.onDragStop.bind(this);
    this.createContextMenuForNode = this.createContextMenuForNode.bind(this);
    this.sync = registerNodeSync(node.id, args => {
      const updatedNode = getUpdatedNode(this.state.node, args.serialisedNode);
      this.setState({ node: updatedNode });
      if (updatedNode.status === NodeStatus.error) {
        console.error(updatedNode.error);
        showTooltip(this.nodeRef.current, updatedNode.error.message);
      } else {
        removeTooltip(this.nodeRef.current);
      }
    });
    this.progress = registerNodeProgress(node.id, args => {
      const stateNode = this.state.node;
      stateNode.summary = args.summary;
      this.setState({ node: stateNode });
    });
  }

  onDragMove(e, data) {
    const { onDrag } = this.props;
    onDrag(data.deltaX, data.deltaY);
  }

  onDragStop(e, data) {
    // Only trigger if we actually dragged
    if (data.deltaX || data.deltaY) {
      const { onDrop } = this.props;
      onDrop();
    }
  }

  createContextMenuForNode() {
    const { node } = this.props;
    const { Menu, MenuItem } = remote;
    const menu = new Menu();
    menu.append(
      new MenuItem({
        checked: node.hot,
        click: () => this.toggleHot(),
        label: 'Hot',
        type: 'checkbox',
      })
    );
    menu.popup({ window: remote.getCurrentWindow() });
  }

  toggleHot() {
    const { node } = this.props;
    node.hot = !node.hot;
    sendNodeSync({ serialisedNode: serialiseNode(node) });
    this.setState({ node });
  }

  componentWillUnmount() {
    unregisterNodeSync(this.sync);
    unregisterNodeProgress(this.progress);
  }

  render() {
    const { positionData, dragGrid } = this.props;
    const { node } = this.state;
    const pos = positionData[node.id];
    const nodeClass = classNames('EditorNode', {
      'EditorNode--cached': node.status === NodeStatus.cached,
      'EditorNode--error': node.status === NodeStatus.error,
      'EditorNode--processing': node.status === NodeStatus.processing,
    });
    const glyphClass = classNames('EditorNode__glyph', {
      'EditorNode__glyph--hot': node.hot,
    });
    const errorOrSummary = node.error ? node.error.message : node.summary;
    return (
      <DraggableCore
        grid={dragGrid}
        onDrag={this.onDragMove}
        onStop={this.onDragStop}
      >
        <g className={nodeClass}>
          <text className="EditorNode__type" x={pos.node.x} y={pos.node.y - 45}>
            {node.type}
          </text>
          <text className="EditorNode__id" x={pos.node.x} y={pos.node.y - 28}>
            {node.id}
          </text>
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
          {errorOrSummary && !node.viewData ? (
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
                key={name}
                name={name}
                node={node}
                x={x}
                y={y}
                size={3}
              />
            ))}
          </g>
          <g className="EditorNode__outPorts">
            {pos.ports.out.map(({ name, x, y }, i) => (
              <EditorNodePort
                key={name}
                name={name}
                node={node}
                x={x}
                y={y}
                size={3}
              />
            ))}
          </g>
          {node.viewData && (
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
              );
              const posTo = pos.ports.in.find(x => x.name === edge.toPort);
              return (
                <EditorNodeEdge
                  key={edge.toPort}
                  fromX={posFrom.x}
                  fromY={posFrom.y}
                  toX={posTo.x}
                  toY={posTo.y}
                  onClick={() => {
                    debug(
                      `requested data passed from "${edge.from.id}/${
                        edge.fromPort
                      }" to "${edge.to.id}/${edge.toPort}"`
                    );
                    sendPortDataRequest({
                      nodeId: edge.from.id,
                      port: edge.fromPort,
                    });
                  }}
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
  node: CocoonNode,
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
