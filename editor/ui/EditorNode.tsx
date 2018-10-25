import classNames from 'classnames';
import React from 'react';
import { CocoonNode, NodeStatus } from '../../core/graph';
import { getNode, readInputPort } from '../../core/nodes';
import {
  registerNodeError,
  registerNodeEvaluated,
  registerNodeStatusUpdate,
  sendEvaluateNode,
  unregisterNodeError,
  unregisterNodeEvaluated,
  unregisterNodeStatusUpdate,
} from '../../ipc';
import { DataView } from './DataView';
import { EditorNodePort } from './EditorNodePort';
import { translate } from './svg';
import { removeTooltip, showTooltip } from './tooltips';

const debug = require('debug')('cocoon:EditorNode');

export interface EditorNodeProps {
  node: CocoonNode;
  positionData: PositionData;
}

export interface EditorNodeState {
  status: NodeStatus;
  error?: Error;
  summary?: string;
  renderingData?: any;
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
  statusUpdate: ReturnType<typeof registerNodeStatusUpdate>;
  evaluated: ReturnType<typeof registerNodeEvaluated>;
  error: ReturnType<typeof registerNodeError>;
  nodeRef: React.RefObject<SVGCircleElement>;

  constructor(props) {
    super(props);
    this.nodeRef = React.createRef();
    const { node } = this.props;
    this.state = {
      error: node.error,
      status: node.status,
      summary: node.summary,
    };
    this.statusUpdate = registerNodeStatusUpdate(node.id, args => {
      this.setState({ status: args.status });
      if (args.status !== NodeStatus.error) {
        removeTooltip(this.nodeRef.current);
      }
    });
    this.evaluated = registerNodeEvaluated(node.id, args => {
      debug(`evaluated ${node.id}`);
      this.setState({
        renderingData: args.renderingData,
        summary: args.summary,
      });
    });
    this.error = registerNodeError(node.id, args => {
      console.error(args.error);
      showTooltip(this.nodeRef.current, args.error.message);
      this.setState({ error: args.error });
    });
  }

  componentWillUnmount() {
    unregisterNodeStatusUpdate(this.statusUpdate);
    unregisterNodeEvaluated(this.evaluated);
    unregisterNodeError(this.error);
  }

  render() {
    const { node, positionData } = this.props;
    const { error, status, summary, renderingData } = this.state;
    const pos = positionData[node.id];
    const gClass = classNames('EditorNode', {
      'EditorNode--cached': status === NodeStatus.cached,
      'EditorNode--error': status === NodeStatus.error,
      'EditorNode--processing': status === NodeStatus.processing,
    });
    const errorOrSummary = error ? error.message : summary;
    return (
      <g className={gClass}>
        <text className="EditorNode__type" x={pos.node.x} y={pos.node.y - 45}>
          {node.type}
        </text>
        <text className="EditorNode__id" x={pos.node.x} y={pos.node.y - 28}>
          {node.id}
        </text>
        <circle
          ref={this.nodeRef}
          className="EditorNode__glyph"
          cx={pos.node.x}
          cy={pos.node.y}
          r="15"
          onClick={() => {
            sendEvaluateNode({ nodeId: node.id });
          }}
        />
        {errorOrSummary ? (
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
            <EditorNodePort key={name} name={name} x={x} y={y} size={3} />
          ))}
        </g>
        <g className="EditorNode__outPorts">
          {pos.ports.out.map(({ name, x, y }, i) => (
            <EditorNodePort key={name} name={name} x={x} y={y} size={3} />
          ))}
        </g>
        <foreignObject
          x={pos.overlay.x}
          y={pos.overlay.y}
          width={pos.overlay.width}
          height={pos.overlay.height}
        >
          <DataView
            nodeId={node.id}
            nodeType={node.type}
            renderingData={renderingData}
            width={pos.overlay.width}
            height={pos.overlay.height}
          />
        </foreignObject>
        {this.renderIncomingEdges()}
      </g>
    );
  }

  renderIncomingEdges() {
    const { node, positionData } = this.props;
    const pos = positionData[node.id];
    return (
      <g className="EditorNode__edges">
        {node.edgesIn.map(edge => {
          const posFrom = positionData[edge.from.id].ports.out.find(
            x => x.name === edge.fromPort
          );
          const posTo = pos.ports.in.find(x => x.name === edge.toPort);
          const xa1 = posFrom.x + (posTo.x - posFrom.x) / 2;
          const ya1 = posFrom.y;
          const xa2 = posTo.x - (posTo.x - posFrom.x) / 2;
          const ya2 = posTo.y;
          const d = `M${posFrom.x},${posFrom.y} C${xa1},${ya1} ${xa2},${ya2} ${
            posTo.x
          },${posTo.y}`;
          return (
            <path
              key={edge.toPort}
              d={d}
              onClick={() => {
                debug(
                  `${edge.from.id}/${edge.fromPort} -> ${edge.to.id}/${
                    edge.toPort
                  }`
                );
                console.info(readInputPort(node, edge.toPort, null));
              }}
            />
          );
        })}
      </g>
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
