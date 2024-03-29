import {
  CocoonRegistry,
  CocoonViewComponent,
  CocoonViewProps,
  GraphNode,
  NodeStatus,
} from '@cocoon/types';
import changeNodeViewState from '@cocoon/util/ipc/changeNodeViewState';
import highlightInViews from '@cocoon/util/ipc/highlightInViews';
import requestNodeView from '@cocoon/util/ipc/requestNodeView';
import requestNodeViewData, {
  Response as ViewDataResponse,
} from '@cocoon/util/ipc/requestNodeViewData';
import sendToNode from '@cocoon/util/ipc/sendToNode';
import requireCocoonView from '@cocoon/util/requireCocoonView';
import Debug from 'debug';
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorPage } from './ErrorPage';
import { ipcContext } from './ipc';
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
  const viewType = node.view!;
  const view = requireCocoonView(registry, viewType);
  const ipc = ipcContext();
  let dataRequestPromise: Promise<ViewDataResponse> | null = null;

  const [error, setError] = useState<Error | null>(null);
  const [viewData, setViewData] = useState(null);
  const [viewComponent, setViewComponent] = useState<{
    type: string;
    value: CocoonViewComponent;
  } | null>(null);

  // When the view type changes, we have two address the period where the view
  // data was generated for the wrong view
  const viewTypeMismatch = viewComponent && viewComponent.type !== node.view;
  if (viewData && viewTypeMismatch) {
    setViewData(null);
    if (!dataRequestPromise) {
      dataRequestPromise = requestNodeViewData(
        ipc,
        { nodeId: node.id },
        args => {
          setViewData(args.viewData);
        }
      );
    }
  }

  // Query view data
  useEffect(() => {
    if (!dataRequestPromise) {
      dataRequestPromise = requestNodeViewData(
        ipc,
        { nodeId: node.id },
        args => {
          setViewData(args.viewData);
        }
      );
    }
  }, [viewDataId]);

  // Resolve view component
  //
  // We do this as late as possible, so that potentially expensive bundle
  // imports are done only when a view is rendered with available data)
  if (view && viewData && (!viewComponent || viewTypeMismatch)) {
    const resolve = async () => {
      const value = await importViewComponent(view, viewType);
      setViewComponent({
        type: viewType,
        value,
      });
    };
    resolve();
  }

  // Remember and unregister callbacks
  //
  // The view can choose to register IPC callbacks, which we have to properly
  // clean up when the view closes.
  const highlightCallback = useRef<any>(null);
  useEffect(() => {
    return () => {
      if (highlightCallback.current) {
        highlightInViews.unregister(ipc, highlightCallback.current);
      }
    };
  }, []);

  // Despite memo(), the view component will still render itself at least twice
  // for new view data, first when receiving the viewDataId, then after having
  // fetched the actual data via IPC. To spare the actual view component from an
  // extra render, we memo it on the data object.
  const renderedViewComponent = useMemo(() => {
    if (!viewData || !viewComponent || viewTypeMismatch) {
      return null;
    }
    const viewDebug = Debug(`ui:${node.id}`);
    const supportedViewStates = node.cocoonNode!.supportedViewStates;
    const viewProps: CocoonViewProps = {
      debug: viewDebug,
      graphNode: node,
      height,
      highlight: data => {
        viewDebug('sending highlighting data', data);
        highlightInViews.send(ipc, {
          data,
          senderNodeId: node.id,
        });
      },
      isPreview,
      node: {
        id: node.id,
        supportedViewStates,
        supportsViewState: key =>
          supportedViewStates ? supportedViewStates.indexOf(key) >= 0 : false,
      },
      query: (query, callback) => {
        viewDebug(`querying data`, query);
        requestNodeView(ipc, { nodeId: node.id, query }, args => {
          viewDebug(`got data query response`, query);
          callback(args);
        });
      },
      registerHighlight: callback => {
        if (highlightCallback.current) {
          throw new Error(`highlight callback can only be registered once`);
        }
        highlightCallback.current = highlightInViews.register(ipc, callback);
      },
      search,
      send: data => {
        sendToNode(ipc, {
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
          changeNodeViewState(ipc, { nodeId: node.id, viewState });
        }
      },
      viewData,
      viewPort: node.viewPort!,
      viewState: node.definition.viewState || {},
      width,
    };
    return React.createElement(viewComponent.value, viewProps);
  }, [viewData, viewComponent]);

  return (
    <>
      <div className={isPreview ? 'preview' : 'root'} style={{ height, width }}>
        {error ? (
          <ErrorPage error={error} compact={isPreview} />
        ) : (
          renderedViewComponent
        )}
      </div>
      <style jsx>{`
        .root {
          width: 100%;
          height: 100%;
        }
        .preview {
          width: 100%;
          height: 100%;
          font-size: var(--font-size-small);
          text-align: center;
          color: var(--color-faded);
        }
      `}</style>
    </>
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
