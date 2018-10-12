import classNames from 'classnames';
import { ipcRenderer } from 'electron';
import React from 'react';
import ReactDOM from 'react-dom';
import { CocoonNode, NodeStatus } from '../../core/graph';
import { DataView } from './DataView';
import { EditorNodePort } from './EditorNodePort';
import { translate } from './svg';

const debug = require('debug')('cocoon:EditorNode');

export interface EditorNodeProps {
  node: CocoonNode;
  nodePosition: ReturnType<typeof calculateNodePosition>;
  overlayBounds: ReturnType<typeof calculateOverlayBounds>;
  portPositions: ReturnType<typeof calculatePortPositions>;
}

export interface EditorNodeState {
  status: NodeStatus;
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
    const { node, nodePosition, overlayBounds, portPositions } = this.props;
    debug('render', node.definition.id, node.status);
    const overlay = ReactDOM.createPortal(
      <DataView
        nodeId={node.definition.id}
        nodeType={node.type}
        renderingData={node.renderingData}
        x={overlayBounds.x}
        y={overlayBounds.y}
        width={overlayBounds.width}
        height={overlayBounds.height}
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
        <text x={nodePosition.x} y={nodePosition.y - 45} textAnchor="middle">
          {node.type}
        </text>
        <text
          x={nodePosition.x}
          y={nodePosition.y - 28}
          textAnchor="middle"
          fontSize="12"
          opacity=".6"
        >
          {node.definition.id}
        </text>
        <circle
          cx={nodePosition.x}
          cy={nodePosition.y}
          r="15"
          onClick={() => {
            ipcRenderer.send('run', node.definition.id);
          }}
        />
        <g className="EditorNode__InPorts">
          {portPositions.in.map(({ name, x, y }, i) => (
            <EditorNodePort key={name} x={x} y={y} size={3} />
          ))}
        </g>
        <g className="EditorNode__OutPorts">
          {portPositions.out.map(({ name, x, y }, i) => (
            <EditorNodePort key={name} x={x} y={y} size={3} />
          ))}
        </g>
        {overlay}
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
  const inPorts = node.definition.in ? Object.keys(node.definition.in) : [];
  const outPorts = node.definition.out ? Object.keys(node.definition.out) : [];
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
