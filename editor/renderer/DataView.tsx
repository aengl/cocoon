import _ from 'lodash';
import React from 'react';
import { getNode } from '../../core/nodes';
import { rendererSendOpenDataViewWindow } from '../ipc';

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
    this.state = {};
  }

  render() {
    const { nodeId, nodeType, renderingData, x, y, width, height } = this.props;
    const node = getNode(nodeType);
    if (node.renderData !== undefined && !_.isNil(renderingData)) {
      return (
        <div
          className="DataView"
          onClick={() => rendererSendOpenDataViewWindow(nodeId)}
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
