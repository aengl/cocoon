import React, { memo, useEffect, useState } from 'react';
import styled from 'styled-components';
import Debug from '../../common/debug';
import { GraphNode, NodeStatus } from '../../common/graph';
import {
  sendQueryNodeViewData,
  sendQueryNodeView,
  sendChangeNodeViewState,
} from '../../common/ipc';
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
    const { height, isPreview, node, viewDataId, width } = props;

    const [error, setError] = useState<Error | null>(null);
    const [viewData, setViewData] = useState(null);

    useEffect(() => {
      sendQueryNodeViewData({ nodeId: node.id }, args => {
        setViewData(args.viewData);
      });
    }, [viewDataId]);

    const handleClick = () => {
      if (isPreview) {
        window.open(
          createURI('node.html', { nodeId: node.id }),
          node.id,
          'width=500,height=500'
        );
      }
    };

    if (error) {
      return (
        <Wrapper>
          <ErrorPage error={error} compact={isPreview} />
        </Wrapper>
      );
    }
    if (!node.view || !viewData) {
      return null;
    }
    const viewObj = getView(node.view);
    const viewDebug = Debug(`editor:${node.id}`);
    return (
      <Wrapper onClick={handleClick} style={{ height, width }}>
        {React.createElement(viewObj.component, {
          context: {
            debug: viewDebug,
            height,
            isPreview,
            node,
            query: (query, callback) => {
              sendQueryNodeView({ nodeId: node.id, query }, callback);
            },
            syncViewState: viewState => {
              if (Object.keys(viewState).length > 0) {
                // In order to conveniently filter unsupported view states we may
                // sometimes call this method with an empty state object. Those
                // calls can safely be ignored.
                viewDebug(`view state changed`, viewState);
                sendChangeNodeViewState({ nodeId: node.id, viewState });
              }
            },
            viewData,
            viewPort: node.viewPort!,
            viewState: node.definition.viewState || {},
            width,
          },
        })}
      </Wrapper>
    );
  },
  (prevProps, nextProps) => {
    // Only update the state when the node is fully processed -- otherwise the
    // status sync at the beginning of the node evaluation will erase the
    // virtual dom for the visualisation (since no view data is available at
    // that point), making state transitions difficult
    if (nextProps.node.state.status === NodeStatus.processed) {
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
