import { CocoonRegistry, GraphNode, NodeStatus } from '@cocoon/types';
import processNodeIfNecessary from '@cocoon/util/ipc/processNodeIfNecessary';
import requestNodeSync from '@cocoon/util/ipc/requestNodeSync';
import requestRegistry from '@cocoon/util/ipc/requestRegistry';
import syncNode from '@cocoon/util/ipc/syncNode';
import React, { memo, useEffect, useState } from 'react';
import { createGlobalStyle } from 'styled-components';
import { createEditorURI } from '../uri';
import { DataView } from './DataView';
import { deserialiseNode, ipcContext } from './ipc';
import { theme } from './theme';

const debug = require('debug')('ui:DataViewWindow');

export interface DataViewWindowProps {
  nodeId: string;
  search: URLSearchParams;
}

export const DataViewWindow = memo((props: DataViewWindowProps) => {
  const ipc = ipcContext();

  const { nodeId, search } = props;
  const [node, setNode] = useState<GraphNode>();
  const [registry, setRegistry] = useState<CocoonRegistry>();

  useEffect(() => {
    // Update when the node sends a sync that contains view data
    const sync = syncNode.register(ipc, nodeId, args => {
      const deserialisedNode = deserialiseNode(
        args.serialisedNode
      ) as GraphNode;
      if (
        deserialisedNode.state.status === NodeStatus.processed &&
        deserialisedNode.state.viewData !== undefined
      ) {
        debug(`received view data`);
        setNode(deserialisedNode);
      }
      // Nodes with open data view windows should be treated as "hot" and be
      // processed whenever they become invalidated
      processNodeIfNecessary(ipc, { nodeId });
    });
    // Request a node sync, which will get us the initial data
    requestNodeSync(ipc, { nodeId });
    return () => {
      syncNode.unregister(ipc, nodeId, sync);
    };
  }, [nodeId]);

  useEffect(() => {
    debug(`requesting registry`);
    requestRegistry(ipc, args => {
      debug(`got registry information`);
      setRegistry(args.registry);
    });
  }, []);

  return (
    <>
      <GlobalStyle />
      {node && registry ? (
        <DataView
          isPreview={false}
          node={node}
          registry={registry}
          search={search}
          viewDataId={node.state.viewDataId}
        />
      ) : null}
    </>
  );
});

export function openDataViewWindow(nodeId: string) {
  window.open(
    createEditorURI('node.html', { nodeId }),
    nodeId,
    'width=500,height=500'
  );
}

const GlobalStyle = createGlobalStyle`
  input, textarea {
    border: 1px solid ${theme.syntax.keyword
      .darken(1)
      .fade(0.2)
      .hex()};
    border-radius: 3px;
    padding: 0.5em;
    color: white;
    background-color: #15100c;
    font-family: inherit;
    font-weight: inherit;
    font-size: var(--font-size-small);
  }
  table {
    font-weight: inherit;
  }
  button {
    cursor: pointer;
    border: 0;
    border-radius: 3px;
    padding: 0.5em;
    color: white;
    background-color: ${theme.syntax.keyword
      .darken(1)
      .fade(0.2)
      .hex()};
  }
`;
