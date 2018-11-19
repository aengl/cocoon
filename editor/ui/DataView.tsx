import _ from 'lodash';
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

export class DataView extends React.Component<DataViewProps, DataViewState> {
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

  shouldComponentUpdate(nextProps: DataViewProps, nextState: DataViewState) {
    const { node } = this.props;
    const { error } = this.state;
    if (nextState.error !== error) {
      return true;
    } else if (!_.isNil(nextProps.node.state.viewData)) {
      // Only update the state when view data is available -- otherwise the
      // status sync at the beginning of the node evaluation will erase the
      // virtual dom for the visualisation, making state transitions difficult
      return node.state.viewData !== nextProps.node.state.viewData;
    }
    return false;
  }

  render() {
    const { node, width, height, isPreview } = this.props;
    const { error } = this.state;
    if (node.view === undefined || node.viewPort === undefined) {
      return null;
    }
    const viewObj = getView(node.view);
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
      syncViewState: state => {
        debug(`view state changed`, state);
        sendNodeViewStateChanged({ nodeId: node.id, state });
      },
      viewData: node.state.viewData,
      viewPort: node.viewPort,
      width,
    };
    return (
      <div
        className="DataView"
        onClick={() => sendOpenDataViewWindow({ nodeId: node.id })}
        style={{ height, width }}
      >
        {!_.isNil(node.state.viewData) &&
          React.createElement(viewObj.component, { context })}
      </div>
    );
  }
}
