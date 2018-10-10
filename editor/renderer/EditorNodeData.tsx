import { ipcRenderer } from 'electron';
import React from 'react';
import { CocoonNode, NodeStatus } from '../../core/graph';
import { createNodeInstance } from '../../core/nodes/create';

const debug = require('debug')('cocoon:EditorNodeDataData');

export interface EditorNodeDataProps {
  node: CocoonNode;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EditorNodeDataState {}

export class EditorNodeData extends React.PureComponent<
  EditorNodeDataProps,
  EditorNodeDataState
> {
  constructor(props) {
    super(props);
    const { node } = this.props;
    this.state = {};
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
    const { node, x, y, width, height } = this.props;
    debug('render', node.definition.id);
    const nodeInstance = createNodeInstance(node.type);
    if (nodeInstance.renderData) {
      return (
        <div
          className="Node__portal"
          onClick={() =>
            ipcRenderer.send('open-data-window', node.definition.id)
          }
          style={{
            height,
            left: x,
            top: y,
            width,
          }}
        >
          {nodeInstance.renderData(node.renderingData, width, height)}
        </div>
      );
    }
    return null;
  }
}
