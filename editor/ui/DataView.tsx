import Debug from 'debug';
import _ from 'lodash';
import React from 'react';
import {
  Callback,
  NodeViewQueryResponseArgs,
  registerNodeViewQueryResponse,
  sendNodeViewQuery,
  sendNodeViewStateChanged,
  sendOpenDataViewWindow,
  serialiseNode,
  unregisterNodeViewQueryResponse,
} from '../../common/ipc';
import { CocoonNode } from '../../common/node';
import { getNode } from '../../core/nodes';

const debug = Debug('cocoon:DataView');

export interface DataViewProps {
  node: CocoonNode;
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
    const { node } = this.props;
    if (this.queryResponse !== undefined) {
      unregisterNodeViewQueryResponse(this.queryResponse);
    }
    this.queryResponse = registerNodeViewQueryResponse(node.id, callback);
  }

  render() {
    const { node, viewData, width, height, isPreview } = this.props;
    const nodeObj = getNode(node.type);
    if (nodeObj.renderView !== undefined && !_.isNil(viewData)) {
      return (
        <div
          className="DataView"
          onClick={() =>
            sendOpenDataViewWindow({ serialisedNode: serialiseNode(node) })
          }
          style={{ height, width }}
        >
          {nodeObj.renderView({
            config: node.config,
            debug: Debug(`cocoon:${node.id}`),
            height,
            isPreview,
            node,
            query: query => {
              sendNodeViewQuery({ nodeId: node.id, query });
            },
            registerQueryListener: callback => {
              this.registerQueryListener(callback);
            },
            setViewState: state => {
              debug(`view state changed`, state);
              sendNodeViewStateChanged({ nodeId: node.id, state });
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
