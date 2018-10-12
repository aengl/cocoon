import classNames from 'classnames';
import { ipcRenderer } from 'electron';
import React from 'react';
import ReactDOM from 'react-dom';
import { CocoonNode, NodeStatus } from '../../core/graph';
import { getNode, readInputPort } from '../../core/nodes';
import { DataView } from './DataView';
import { EditorNodePort } from './EditorNodePort';
import { translate } from './svg';

const debug = require('debug')('cocoon:EditorNode');

export interface EditorNodeProps {
  node: CocoonNode;
  positionData: PositionData;
}

export interface EditorNodeState {
  status: NodeStatus;
}

export interface PositionData {
  [nodeId: string]: {
    node: ReturnType<typeof calculateNodePosition>;
    overlay: ReturnType<typeof calculateOverlayBounds>;
    ports: ReturnType<typeof calculatePortPositions>;
  };
}

export class EditorNode extends React.PureComponent<
  EditorNodeProps,
  EditorNodeState
> {
  constructor(props) {
    super(props);
    const { node } = this.props;
    this.state = {
      status: node.status,
    };
    ipcRenderer.on(
      'node-status-update',
      (event: Electron.Event, nodeId: string, status: NodeStatus) => {
        if (nodeId === node.definition.id) {
          this.setState({ status });
        }
      }
    );
    ipcRenderer.on(
      'node-evaluated',
      (event: Electron.Event, nodeId: string, status: NodeStatus) => {
        if (nodeId === node.definition.id) {
          this.forceUpdate();
        }
      }
    );
  }

  render() {
    const { node, positionData } = this.props;
    debug('render', node.definition.id, node.status);
    const pos = positionData[node.definition.id];
    const overlay = ReactDOM.createPortal(
      <DataView
        nodeId={node.definition.id}
        nodeType={node.type}
        renderingData={node.renderingData}
        x={pos.overlay.x}
        y={pos.overlay.y}
        width={pos.overlay.width}
        height={pos.overlay.height}
      />,
      document.getElementById('portals')
    );
    const gClass = classNames('EditorNode', {
      'EditorNode--cached': node.status === NodeStatus.cached,
      'EditorNode--error': node.status === NodeStatus.error,
      'EditorNode--processing': node.status === NodeStatus.processing,
    });
    return (
      <g className={gClass}>
        <text x={pos.node.x} y={pos.node.y - 45} textAnchor="middle">
          {node.type}
        </text>
        <text
          x={pos.node.x}
          y={pos.node.y - 28}
          textAnchor="middle"
          fontSize="12"
          opacity=".6"
        >
          {node.definition.id}
        </text>
        <circle
          cx={pos.node.x}
          cy={pos.node.y}
          r="15"
          onClick={() => {
            ipcRenderer.send('run', node.definition.id);
          }}
        />
        <g className="EditorNode__inPorts">
          {pos.ports.in.map(({ name, x, y }, i) => (
            <EditorNodePort key={name} x={x} y={y} size={3} />
          ))}
        </g>
        <g className="EditorNode__outPorts">
          {pos.ports.out.map(({ name, x, y }, i) => (
            <EditorNodePort key={name} x={x} y={y} size={3} />
          ))}
        </g>
        {overlay}
        {this.renderIncomingEdges()}
      </g>
    );
  }

  renderIncomingEdges() {
    const { node, positionData } = this.props;
    const pos = positionData[node.definition.id];
    return (
      <g className="EditorNode__edges">
        {node.edgesIn.map(edge => {
          const posFrom = positionData[edge.from.definition.id].ports.out.find(
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
                // tslint:disable-next-line:no-console
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
