import _ from 'lodash';
import React from 'react';
import styled from 'styled-components';
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
  viewDataId: number | undefined;
}

export class DataView extends React.Component<DataViewProps, DataViewState> {
  constructor(props: DataViewProps) {
    super(props);
    this.state = {
      error: null,
      viewDataId: props.node.state.viewDataId,
    };
  }

  handleClick = () => {
    const { node, isPreview } = this.props;
    if (isPreview) {
      window.open(
        createURI('node.html', { nodeId: node.id }),
        node.id,
        'width=500,height=500'
      );
    }
  };

  componentWillReceiveProps(nextProps: DataViewProps) {
    this.setState({
      error: null,
      viewDataId: nextProps.node.state.viewDataId,
    });
  }

  componentDidCatch(error: Error) {
    console.error(error.message, error);
    this.setState({ error });
  }

  shouldComponentUpdate(nextProps: DataViewProps, nextState: DataViewState) {
    // Only update the state when view data is available -- otherwise the status
    // sync at the beginning of the node evaluation will erase the virtual dom
    // for the visualisation, making state transitions difficult
    if (!_.isNil(nextProps.node.state.viewData)) {
      // Update only if the view data id changes; the core process generates a
      // new id each time the data is serialised
      return this.state.viewDataId !== nextState.viewDataId;
    }
    return false;
  }

  createContext(): ViewContext {
    const { node, width, height, isPreview } = this.props;
    const viewDebug = Debug(`editor:${node.id}`);
    return {
      debug: viewDebug,
      height,
      isPreview,
      node,
      query: (query, callback) => {
        sendNodeViewQuery({ nodeId: node.id, query }, callback);
      },
      syncViewState: state => {
        if (Object.keys(state).length > 0) {
          // In order to conveniently filter unsupported view states we may
          // sometimes call this method with an empty state object. Those calls can
          // safely be ignored.
          viewDebug(`view state changed`, state);
          sendNodeViewStateChanged({ nodeId: node.id, state });
        }
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
        <Wrapper>
          <ErrorPage error={error} compact={isPreview} />
        </Wrapper>
      );
    }
    const viewObj = getView(node.view);
    return (
      <Wrapper onClick={this.handleClick} style={{ height, width }}>
        {React.createElement(viewObj.component, {
          context: this.createContext(),
        })}
      </Wrapper>
    );
  }
}

const Wrapper = styled.div`
  width: 100%;
  height: 100%;
`;
