import Debug from 'debug';
import React, { memo, useEffect, useState } from 'react';
import styled from 'styled-components';
import { GraphNode, NodeStatus } from '../../common/graph';
import {
  sendChangeNodeViewState,
  sendQueryNodeView,
  sendQueryNodeViewData,
} from '../../common/ipc';
import { CocoonRegistry, requireCocoonView } from '../../common/registry';
import { CocoonView, CocoonViewComponent } from '../../common/view';
import { createEditorURI } from '../uri';
import { ErrorPage } from './ErrorPage';
import { importViewComponent } from './modules';

const debug = Debug('editor:DataView');

export interface DataViewProps {
  height?: number;
  isPreview: boolean;
  node: GraphNode;
  registry: CocoonRegistry;
  width?: number;
  viewDataId?: number;
}

export const DataView = memo(
  (props: DataViewProps) => {
    const { height, isPreview, node, registry, viewDataId, width } = props;
    const viewName = node.view;
    if (!viewName) {
      return null;
    }

    const [error, setError] = useState<Error | null>(null);
    const [viewData, setViewData] = useState(null);
    const [viewComponent, setViewComponent] = useState<{
      value: CocoonViewComponent;
    } | null>(null);

    // Resolve view
    let view: CocoonView;
    try {
      view = requireCocoonView(registry, viewName);
    } catch (error) {
      return renderError(error, isPreview);
    }

    // Query view data
    useEffect(() => {
      sendQueryNodeViewData({ nodeId: node.id }, args => {
        setViewData(args.viewData);
      });
    }, [viewDataId]);

    // Resolve view component
    useEffect(() => {
      if (view) {
        const resolve = async () => {
          const value = await importViewComponent(view, viewName);
          setViewComponent({ value });
        };
        resolve();
      }
    }, [node, registry]);

    const handleClick = () => {
      if (isPreview) {
        window.open(
          createEditorURI('node.html', { nodeId: node.id }),
          node.id,
          'width=500,height=500'
        );
      }
    };

    if (error) {
      return renderError(error, isPreview);
    }
    if (!viewData || !viewComponent) {
      return null;
    }
    const viewDebug = Debug(`editor:${node.id}`);
    return (
      <Wrapper onClick={handleClick} style={{ height, width }}>
        {React.createElement(viewComponent.value, {
          context: {
            debug: viewDebug,
            graphNode: node,
            height,
            isPreview,
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

function renderError(error: Error, isPreview: boolean) {
  return (
    <Wrapper>
      <ErrorPage error={error} compact={isPreview} />
    </Wrapper>
  );
}

const Wrapper = styled.div`
  width: 100%;
  height: 100%;
`;
