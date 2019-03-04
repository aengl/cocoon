import _ from 'lodash';
import React, { memo, useState } from 'react';
import styled from 'styled-components';
import Debug from '../../common/debug';
import { GraphNode } from '../../common/graph';
import { sendNodeViewQuery, sendNodeViewStateChanged } from '../../common/ipc';
import { getView } from '../../common/views';
import { createURI } from '../uri';
import { ErrorPage } from './ErrorPage';

const debug = Debug('editor:DataView');

export interface DataViewProps {
  height?: number;
  isPreview: boolean;
  node: GraphNode;
  width?: number;
  viewDataId?: number;
}

export const DataView = memo(
  (props: DataViewProps) => {
    const { height, isPreview, node, width } = props;

    const [error, setError] = useState<Error | null>(null);

    const handleClick = () => {
      if (isPreview) {
        window.open(
          createURI('node.html', { nodeId: node.id }),
          node.id,
          'width=500,height=500'
        );
      }
    };

    const createContext = () => {
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
    };

    if (error) {
      return (
        <Wrapper>
          <ErrorPage error={error} compact={isPreview} />
        </Wrapper>
      );
    }
    if (!node.view || !node.state.viewData) {
      return null;
    }
    const viewObj = getView(node.view);
    return (
      <Wrapper onClick={handleClick} style={{ height, width }}>
        {React.createElement(viewObj.component, {
          context: createContext(),
        })}
      </Wrapper>
    );
  },
  (prevProps, nextProps) => {
    // Only update the state when view data is available -- otherwise the status
    // sync at the beginning of the node evaluation will erase the virtual dom
    // for the visualisation, making state transitions difficult
    if (!_.isNil(nextProps.node.state.viewData)) {
      // Update only if the view data id changes; the core process generates a
      // new id each time the data is serialised
      return prevProps.viewDataId === nextProps.viewDataId;
    }
    return true;
  }
);

const Wrapper = styled.div`
  width: 100%;
  height: 100%;
`;
