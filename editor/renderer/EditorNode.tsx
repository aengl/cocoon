import classNames from 'classnames';
import { ipcRenderer } from 'electron';
import React from 'react';
import ReactDOM from 'react-dom';
import { CocoonNode, NodeStatus } from '../../core/graph';
import { DataView } from './DataView';
import { EditorNodePort } from './EditorNodePort';

const debug = require('debug')('cocoon:EditorNode');

export interface EditorNodeProps {
  node: CocoonNode;
  gridX: number;
  gridY: number;
  gridWidth?: number;
  gridHeight?: number;
}

export interface EditorNodeState {
  status: NodeStatus;
}

export class EditorNode extends React.PureComponent<
  EditorNodeProps,
  EditorNodeState
> {
  public static defaultProps: Partial<EditorNodeProps> = {
    gridHeight: 100,
    gridWidth: 150,
  };

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
    const { node, gridX, gridY, gridWidth, gridHeight } = this.props;
    debug('render', node.definition.id, node.status);
    const x = gridX * gridWidth - gridWidth / 2;
    const y = gridY * gridHeight - gridHeight / 2;
    const nodeX = gridWidth / 2;
    const nodeY = gridHeight / 2;
    const overlay = ReactDOM.createPortal(
      <DataView
        nodeId={node.definition.id}
        nodeType={node.type}
        renderingData={node.renderingData}
        x={x}
        y={y + gridHeight}
        width={gridWidth}
        height={gridHeight}
      />,
      document.getElementById('portals')
    );
    const gClass = classNames('EditorNode', {
      'EditorNode--cached': node.status === NodeStatus.cached,
      'EditorNode--error': node.status === NodeStatus.error,
      'EditorNode--processing': node.status === NodeStatus.processing,
    });
    return (
      <g className={gClass} transform={`translate(${x},${y})`}>
        <text x={nodeX} y={nodeY - 45} textAnchor="middle">
          {node.type}
        </text>
        <text
          x={nodeX}
          y={nodeY - 28}
          textAnchor="middle"
          fontSize="12"
          opacity=".6"
        >
          {node.definition.id}
        </text>
        <circle
          cx={nodeX}
          cy={nodeY}
          r="15"
          onClick={() => {
            ipcRenderer.send('run', node.definition.id);
          }}
        />
        <g
          className="EditorNode__ports"
          transform={`translate(${nodeX},${nodeY})`}
        >
          {this.renderPorts()}
        </g>
        <div
          style={{
            left: x,
            position: 'absolute',
            top: y,
          }}
        >
          {overlay}
        </div>
      </g>
    );
  }

  renderPorts() {
    const { node } = this.props;
    const inPorts = node.definition.in ? Object.keys(node.definition.in) : [];
    const outPorts = node.definition.out
      ? Object.keys(node.definition.out)
      : [];
    const offsetX = 22;
    const availableHeight = 50;
    const inStep = 1 / (inPorts.length + 1);
    const outStep = 1 / (outPorts.length + 1);
    return (
      <>
        {outPorts.map((port, i) => {
          const y = (i + 1) * outStep;
          return (
            <EditorNodePort
              key={port}
              x={offsetX - Math.cos(y * 2 * Math.PI) * 3}
              y={y * availableHeight - availableHeight / 2}
              size={3}
            />
          );
        })}
        {inPorts.map((port, i) => {
          const y = (i + 1) * inStep;
          return (
            <EditorNodePort
              key={port}
              x={-offsetX + Math.cos(y * 2 * Math.PI) * 3}
              y={y * availableHeight - availableHeight / 2}
              size={3}
            />
          );
        })}
      </>
    );
  }
}
