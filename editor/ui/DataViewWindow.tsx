import React, { memo, useEffect, useState } from 'react';
import { GraphNode } from '../../common/graph';
import {
  deserialiseNode,
  registerSyncNode,
  sendProcessNodeIfNecessary,
  sendRequestNodeSync,
  unregisterSyncNode,
} from '../../common/ipc';
import { DataView } from './DataView';

const debug = require('debug')('editor:DataViewWindow');

export interface DataViewWindowProps {
  nodeId: string;
}

export const DataViewWindow = memo((props: DataViewWindowProps) => {
  const { nodeId } = props;
  const [node, setNode] = useState<GraphNode>();

  useEffect(() => {
    // Update when the node sends a sync that contains view data
    const sync = registerSyncNode(nodeId, args => {
      const deserialisedNode = deserialiseNode(
        args.serialisedNode
      ) as GraphNode;
      if (deserialisedNode.state.viewData !== undefined) {
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

  return node ? (
    <DataView
      node={node}
      isPreview={false}
      viewDataId={node.state.viewDataId}
    />
  ) : null;
});
