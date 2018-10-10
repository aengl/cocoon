import { ipcRenderer } from 'electron';
import React from 'react';
import { NodeStatus } from '../../core/graph';
import { createNodeInstance } from '../../core/nodes/create';

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
  constructor(props) {
    super(props);
    const { nodeId } = this.props;
    this.state = {};
    ipcRenderer.on(
      'node-evaluated',
      (event: Electron.Event, evaluatedNodeId: string, status: NodeStatus) => {
        if (evaluatedNodeId === nodeId) {
          this.forceUpdate();
        }
      }
    );
  }

  render() {
    const { nodeId, nodeType, renderingData, x, y, width, height } = this.props;
    debug('render', nodeId);
    const nodeInstance = createNodeInstance(nodeType);
    if (nodeInstance.renderData) {
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
          {nodeInstance.renderData(renderingData, width, height)}
        </div>
      );
    }
    return null;
  }
}
