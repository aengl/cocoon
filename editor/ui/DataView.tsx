import _ from 'lodash';
import React from 'react';
import { getNode } from '../../core/nodes';
import { sendOpenDataViewWindow } from '../../ipc';

const debug = require('debug')('cocoon:DataView');

export interface DataViewProps {
  nodeId: string;
  nodeType: string;
  viewData: object;
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
    const { nodeId, nodeType, viewData, width, height } = this.props;
    const node = getNode(nodeType);
    if (node.renderData !== undefined && !_.isNil(viewData)) {
      return (
        <div
          className="DataView"
          onClick={() => sendOpenDataViewWindow({ nodeId, nodeType })}
          style={{
            height,
            width,
          }}
        >
          {node.renderData(viewData, width, height)}
        </div>
      );
    }
    return null;
  }
}
