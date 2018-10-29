import Debug from 'debug';
import _ from 'lodash';
import React from 'react';
import { getNode } from '../../core/nodes';
import {
  Callback,
  NodeViewQueryResponseArgs,
  registerNodeViewQueryResponse,
  sendNodeViewQuery,
  sendNodeViewStateChanged,
  sendOpenDataViewWindow,
  unregisterNodeViewQueryResponse,
} from '../../ipc';

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
  queryResponse?: ReturnType<typeof registerNodeViewQueryResponse>;

  constructor(props) {
    super(props);
    this.state = {};
  }

  componentWillUnmount() {
    if (this.queryResponse !== undefined) {
      unregisterNodeViewQueryResponse(this.queryResponse);
    }
  }

  registerQueryListener(callback: Callback<NodeViewQueryResponseArgs>) {
    const { nodeId } = this.props;
    if (this.queryResponse !== undefined) {
      unregisterNodeViewQueryResponse(this.queryResponse);
    }
    this.queryResponse = registerNodeViewQueryResponse(nodeId, callback);
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
            height,
            isPreview,
            nodeId,
            nodeType,
            query: query => {
              sendNodeViewQuery({ nodeId, query });
            },
            registerQueryListener: callback => {
              this.registerQueryListener(callback);
            },
            setViewState: state => {
              debug(`view state changed`);
              sendNodeViewStateChanged({ nodeId, state });
            },
            viewData,
            width,
          })}
        </div>
      );
    }
    return null;
  }
}
