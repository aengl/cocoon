import React, { memo, useEffect, useState } from 'react';
import { createGlobalStyle } from 'styled-components';
import { GraphNode, NodeStatus } from '../../common/graph';
import {
  deserialiseNode,
  registerSyncNode,
  sendProcessNodeIfNecessary,
  sendRequestNodeSync,
  sendRequestRegistry,
  unregisterSyncNode,
} from '../../common/ipc';
import { CocoonRegistry } from '../../common/registry';
import { DataView } from './DataView';
import { theme } from './theme';

const debug = require('debug')('editor:DataViewWindow');

export interface DataViewWindowProps {
  nodeId: string;
}

export const DataViewWindow = memo((props: DataViewWindowProps) => {
  const { nodeId } = props;
  const [node, setNode] = useState<GraphNode>();
  const [registry, setRegistry] = useState<CocoonRegistry>();

  useEffect(() => {
    // Update when the node sends a sync that contains view data
    const sync = registerSyncNode(nodeId, args => {
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
      sendProcessNodeIfNecessary({ nodeId });
    });
    // Request a node sync, which will get us the initial data
    sendRequestNodeSync({ nodeId });
    return () => {
      unregisterSyncNode(nodeId, sync);
    };
  }, [nodeId]);

  useEffect(() => {
    debug(`requesting registry`);
    sendRequestRegistry(args => {
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
          viewDataId={node.state.viewDataId}
        />
      ) : null}
    </>
  );
});

const GlobalStyle = createGlobalStyle`
input, textarea {
    border: 2px inset ${theme.syntax.keyword
      .darken(1)
      .fade(0.2)
      .hex()};
    color: white;
    background-color: transparent;
    margin: 0.5em 0;
    padding: 0.5em;
  }
  button {
    border: 0;
    border-radius: 5px;
    color: white;
    background-color: ${theme.syntax.keyword
      .darken(1)
      .fade(0.2)
      .hex()};
    margin: 0.5em 0;
    padding: 0.5em;
  }
`;
