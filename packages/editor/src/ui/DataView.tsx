import {
  sendChangeNodeViewState,
  sendQueryNodeView,
  sendQueryNodeViewData,
  sendToNode,
} from '@cocoon/ipc';
import {
  CocoonRegistry,
  CocoonViewComponent,
  CocoonViewProps,
  GraphNode,
  NodeStatus,
} from '@cocoon/types';
import requireCocoonView from '@cocoon/util/requireCocoonView';
import Debug from 'debug';
import React, { memo, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { ErrorPage } from './ErrorPage';
import { importViewComponent } from './modules';

export interface DataViewProps {
  height?: number;
  isPreview: boolean;
  node: GraphNode;
  registry: CocoonRegistry;
  search?: URLSearchParams;
  width?: number;
  viewDataId?: number;
}

export const DataView = memo(DataViewComponent, viewPropsAreEqual);

function DataViewComponent(props: DataViewProps) {
  const {
    height,
    isPreview,
    node,
    registry,
    search,
    viewDataId,
    width,
  } = props;
  const viewName = node.view!;
  const view = requireCocoonView(registry, viewName);

  const [error, setError] = useState<Error | null>(null);
  const [viewData, setViewData] = useState(null);
  const [viewComponent, setViewComponent] = useState<{
    value: CocoonViewComponent;
  } | null>(null);

  // Query view data
  useEffect(() => {
    sendQueryNodeViewData({ nodeId: node.id }, args => {
      setViewData(args.viewData);
    });
  }, [viewDataId]);

  // Resolve view component
  //
  // We do this as late as possible, so that potentially expensive bundle
  // imports are done only when a view is rendered with available data)
  if (view && viewData && !viewComponent) {
    const resolve = async () => {
      const value = await importViewComponent(view, viewName);
      setViewComponent({ value });
    };
    resolve();
  }

  // Despite memo(), the view component will still render itself at least twice
  // for new view data, first when receiving the viewDataId, then after having
  // fetched the actual data via IPC. To spare the actual view component from an
  // extra render, we memo it on the data object.
  const renderedViewComponent = useMemo(() => {
    if (!viewData || !viewComponent) {
      return null;
    }
    const viewDebug = Debug(`editor:${node.id}`);
    const supportedViewStates = node.cocoonNode!.supportedViewStates;
    return React.createElement(viewComponent.value, {
      debug: viewDebug,
      graphNode: node,
      height,
      isPreview,
      node: {
        id: node.id,
        supportedViewStates,
        supportsViewState: key =>
          supportedViewStates ? supportedViewStates.indexOf(key) >= 0 : false,
      },
      query: (query, callback) => {
        viewDebug(`querying data`, query);
        sendQueryNodeView({ nodeId: node.id, query }, args => {
          viewDebug(`got data query response`, query);
          callback(args);
        });
      },
      search,
      send: data => {
        sendToNode({
          data,
          nodeId: node.id,
        });
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
    });
  }, [viewData, viewComponent]);

  // Handle error & missing data
  if (error) {
    return renderError(error, isPreview);
  }

  return isPreview ? (
    <PreviewWrapper style={{ height, width }}>
      {renderedViewComponent}
    </PreviewWrapper>
  ) : (
    <Wrapper style={{ height, width }}>{renderedViewComponent}</Wrapper>
  );
}

function viewPropsAreEqual(prevProps: DataViewProps, nextProps: DataViewProps) {
  // Only update the state when the node is fully processed -- otherwise the
  // status sync at the beginning of the node evaluation will erase the
  // virtual dom for the visualisation (since no view data is available at
  // that point), making state transitions difficult
  if (nextProps.node.state.status === NodeStatus.processed) {
    // Update only if the view data id changes; the Cocoon process generates a
    // new id each time the data is serialised
    return prevProps.viewDataId === nextProps.viewDataId;
  }
  return true;
}

function renderError(error: Error, isPreview: boolean) {
  return (
    <Wrapper>
      <ErrorPage error={error} compact={isPreview} />
    </Wrapper>
  );
}

const PreviewWrapper = styled.div`
  width: 100%;
  height: 100%;
  font-size: var(--font-size-small);
  text-align: center;
  color: var(--color-faded);
`;

const Wrapper = styled.div`
  width: 100%;
  height: 100%;
`;
