import React from 'react';
import Debug from '../../common/debug';
import { GraphNode } from '../../common/graph';
import {
  sendNodeViewQuery,
  sendNodeViewStateChanged,
  sendOpenDataViewWindow,
} from '../../common/ipc';
import { ViewContext } from '../../common/view';
import { getView } from '../../common/views';
import { ErrorPage } from './ErrorPage';

const debug = Debug('editor:DataView');

export interface DataViewProps {
  node: GraphNode;
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
    const viewObj = getView(node.type);
    if (error !== null) {
      return (
        <div className="DataView">
          <ErrorPage error={error} compact={isPreview} />
        </div>
      );
    }
    const context: ViewContext = {
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
    };
    return (
      <div
        className="DataView"
        onClick={() => sendOpenDataViewWindow({ nodeId: node.id })}
        style={{ height, width }}
      >
        {React.createElement(viewObj as any, { context })}
      </div>
    );
  }
}
