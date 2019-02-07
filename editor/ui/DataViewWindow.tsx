import React, { memo, useEffect, useState } from 'react';
import { GraphNode } from '../../common/graph';
import {
  deserialiseNode,
  registerNodeSync,
  sendProcessNodeIfNecessary,
  sendRequestNodeSync,
  unregisterNodeSync,
} from '../../common/ipc';
import { DataView } from './DataView';

const debug = require('../../common/debug')('editor:DataViewWindow');

export interface DataViewWindowProps {
  nodeId: string;
}

export const DataViewWindow = memo((props: DataViewWindowProps) => {
  const { nodeId } = props;
  const [node, setNode] = useState<GraphNode | null>(null);
  useEffect(() => {
    // Update when the node sends a sync that contains view data
    const sync = registerNodeSync(nodeId, args => {
      const deserialisedNode = deserialiseNode(args.serialisedNode);
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
      unregisterNodeSync(nodeId, sync);
    };
  }, []);
  return node ? <DataView node={node} isPreview={false} /> : null;
});
