import _ from 'lodash';
import React from 'react';
import Debug from '../../common/debug';
import { GraphNode } from '../../common/graph';
import { sendNodeViewQuery, sendNodeViewStateChanged } from '../../common/ipc';
import { ViewContext } from '../../common/view';
import { getView } from '../../common/views';
import { createURI } from '../uri';
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

  handleClick = () => {
    const { node, isPreview } = this.props;
    if (isPreview) {
      window.open(
        createURI('dataView.html', { nodeId: node.id }),
        node.id,
        'width=500,height=500'
      );
    }
  };

  componentWillReceiveProps() {
    this.setState({ error: null });
  }

  componentDidCatch(error: Error) {
    console.error(error);
    this.setState({ error });
  }

  shouldComponentUpdate(nextProps: DataViewProps, nextState: DataViewState) {
    if (!_.isNil(nextProps.node.state.viewData)) {
      // Only update the state when view data is available -- otherwise the
      // status sync at the beginning of the node evaluation will erase the
      // virtual dom for the visualisation, making state transitions difficult
      return true;
    }
    return false;
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
    if (node.view === undefined || node.state.viewData === undefined) {
      return null;
    }
    const { error } = this.state;
    if (error !== null) {
      return (
        <div className="DataView">
          <ErrorPage error={error} compact={isPreview} />
        </div>
      );
    }
    const viewObj = getView(node.view);
    return (
      <div
        className="DataView"
        onClick={this.handleClick}
        style={{ height, width }}
      >
        {React.createElement(viewObj.component, {
          context: this.createContext(),
        })}
      </div>
    );
  }
}
