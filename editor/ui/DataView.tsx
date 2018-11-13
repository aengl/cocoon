import _ from 'lodash';
import React from 'react';
import Debug from '../../common/debug';
import { CocoonNode } from '../../common/graph';
import {
  sendNodeViewQuery,
  sendNodeViewStateChanged,
  sendOpenDataViewWindow,
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
  constructor(props) {
    super(props);
    this.state = {
      error: null,
    };
  }

  componentWillReceiveProps() {
    this.setState({ error: null });
  }

  componentDidCatch(error: Error, info) {
    console.error(error);
    this.setState({ error });
    console.info(info);
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
    if (nodeObj.renderView !== undefined && !_.isNil(node.state.viewData)) {
      return (
        <div
          className="DataView"
          onClick={() => sendOpenDataViewWindow({ nodeId: node.id })}
          style={{ height, width }}
        >
          {nodeObj.renderView({
            debug: Debug(`editor:${node.id}`),
            height,
            isPreview,
            node,
            query: (query, callback) => {
              sendNodeViewQuery({ nodeId: node.id, query }, callback);
            },
            setViewState: state => {
              debug(`view state changed`, state);
              sendNodeViewStateChanged({ nodeId: node.id, state });
            },
            viewData: node.state.viewData,
            width,
          })}
        </div>
      );
    }
    return null;
  }
}
