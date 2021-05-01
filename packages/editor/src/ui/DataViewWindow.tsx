import { CocoonRegistry, GraphNode, NodeStatus } from '@cocoon/types';
import processNodeIfNecessary from '@cocoon/util/ipc/processNodeIfNecessary';
import requestNodeSync from '@cocoon/util/ipc/requestNodeSync';
import requestRegistry from '@cocoon/util/ipc/requestRegistry';
import syncNode from '@cocoon/util/ipc/syncNode';
import _ from 'lodash';
import React, { memo, useEffect, useState } from 'react';
import { createEditorURI } from '../uri';
import { DataView } from './DataView';
import { deserialiseNode, ipcContext } from './ipc';

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

export function openDataViewWindow(node: GraphNode) {
  const width = _.get(node.definition.viewState, 'width', 500);
  const height = _.get(node.definition.viewState, 'height', 500);
  window.open(
    createEditorURI('node.html', { nodeId: node.id }),
    node.id,
    `width=${width},height=${height}`
  );
}
