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

  componentDidCatch(error: Error) {
    console.error(error);
    this.setState({ error });
  }

  createContext(): ViewContext {
    const { node, width, height, isPreview } = this.props;
    return {
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
      viewPort: node.viewPort!,
      viewState: node.definition.viewState || {},
      width,
    };
  }

  render() {
    const { node, width, height, isPreview } = this.props;
    const { error } = this.state;
    if (node.view === undefined) {
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
    if (!isPreview) {
      debug(`updating view for "${node.id}"`);
    }
    return (
      <div
        className="DataView"
        onClick={() => sendOpenDataViewWindow({ nodeId: node.id })}
        style={{ height, width }}
      >
        {!_.isNil(node.state.viewData) &&
          React.createElement(viewObj.component, {
            context: this.createContext(),
          })}
      </div>
    );
  }
}
