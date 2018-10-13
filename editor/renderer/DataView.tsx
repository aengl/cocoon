import { ipcRenderer } from 'electron';
import React from 'react';
import { NodeStatus } from '../../core/graph';
import { getNode } from '../../core/nodes';
import { IPCListener } from './ipc';

const debug = require('debug')('cocoon:DataView');

export interface DataViewProps {
  nodeId: string;
  nodeType: string;
  renderingData: object;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DataViewState {}

export class DataView extends React.PureComponent<
  DataViewProps,
  DataViewState
> {
  evaluatedListener: IPCListener;

  constructor(props) {
    super(props);
    const { nodeId } = this.props;
    this.state = {};
    this.evaluatedListener = (
      event: Electron.Event,
      evaluatedNodeId: string,
      status: NodeStatus
    ) => {
      if (evaluatedNodeId === nodeId) {
        this.forceUpdate();
      }
    };
  }

  componentDidMount() {
    ipcRenderer.on('node-evaluated', this.evaluatedListener);
  }

  componentWillUnmount() {
    ipcRenderer.removeListener('node-evaluated', this.evaluatedListener);
  }

  render() {
    const { nodeId, nodeType, renderingData, x, y, width, height } = this.props;
    debug('render', nodeId);
    const node = getNode(nodeType);
    if (node.renderData) {
      return (
        <div
          className="DataView"
          onClick={() =>
            debug('click') || ipcRenderer.send('open-data-window', nodeId)
          }
          style={{
            height,
            left: x,
            top: y,
            width,
          }}
        >
          {node.renderData(renderingData, width, height)}
        </div>
      );
    }
    return null;
  }
}
