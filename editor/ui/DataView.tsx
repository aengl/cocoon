import _ from 'lodash';
import React from 'react';
import Debug from '../../common/debug';
import { CocoonNode } from '../../common/graph';
import {
  Callback,
  NodeViewQueryResponseArgs,
  registerNodeViewQueryResponse,
  sendNodeViewQuery,
  sendNodeViewStateChanged,
  sendOpenDataViewWindow,
  unregisterNodeViewQueryResponse,
} from '../../common/ipc';
import { getNode } from '../../core/nodes';
import { ErrorPage } from './ErrorPage';

const debug = Debug('editor:DataView');

export interface DataViewProps {
  node: CocoonNode;
  width?: number;
  height?: number;
  isPreview: boolean;
}

export interface DataViewState {
  error: Error | null;
}

export class DataView extends React.PureComponent<
  DataViewProps,
  DataViewState
> {
  queryResponse?: ReturnType<typeof registerNodeViewQueryResponse>;

  constructor(props) {
    super(props);
    this.state = {
      error: null,
    };
  }

  componentWillReceiveProps() {
    this.setState({ error: null });
  }

  componentWillUnmount() {
    if (this.queryResponse !== undefined) {
      const { node } = this.props;
      unregisterNodeViewQueryResponse(node.id, this.queryResponse);
    }
  }

  componentDidCatch(error: Error, info) {
    console.error(error);
    this.setState({ error });
    console.info(info);
  }

  registerQueryListener(callback: Callback<NodeViewQueryResponseArgs>) {
    const { node } = this.props;
    if (this.queryResponse !== undefined) {
      unregisterNodeViewQueryResponse(node.id, this.queryResponse);
    }
    this.queryResponse = registerNodeViewQueryResponse(node.id, callback);
  }

  render() {
    const { node, width, height, isPreview } = this.props;
    const { error } = this.state;
    const nodeObj = getNode(node.type);
    if (error !== null) {
      return (
        <div className="DataView">
          <ErrorPage error={error} compact={isPreview} />
        </div>
      );
    }
    if (nodeObj.renderView !== undefined && !_.isNil(node.viewData)) {
      return (
        <div
          className="DataView"
          onClick={() => sendOpenDataViewWindow({ nodeId: node.id })}
          style={{ height, width }}
        >
          {nodeObj.renderView({
            config: node.config || {},
            debug: Debug(`editor:${node.id}`),
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
            viewData: node.viewData,
            width,
          })}
        </div>
      );
    }
    return null;
  }
}
