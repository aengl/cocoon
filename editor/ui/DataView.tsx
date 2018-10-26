import Debug from 'debug';
import _ from 'lodash';
import React from 'react';
import { getNode } from '../../core/nodes';
import { sendNodeViewStateChanged, sendOpenDataViewWindow } from '../../ipc';

const debug = Debug('cocoon:DataView');

export interface DataViewProps {
  nodeId: string;
  nodeType: string;
  viewData: object;
  width?: number;
  height?: number;
  isPreview: boolean;
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
    const { nodeId, nodeType, viewData, width, height, isPreview } = this.props;
    const nodeObj = getNode(nodeType);
    if (nodeObj.renderView !== undefined && !_.isNil(viewData)) {
      return (
        <div
          className="DataView"
          onClick={() => sendOpenDataViewWindow({ nodeId, nodeType })}
          style={{ height, width }}
        >
          {nodeObj.renderView({
            debug: Debug(`cocoon:${nodeId}`),
            isPreview,
            setViewState: state => {
              debug(`view state changed for "${nodeId}"`);
              sendNodeViewStateChanged({ nodeId, state });
            },
            viewData,
          })}
        </div>
      );
    }
    return null;
  }
}
