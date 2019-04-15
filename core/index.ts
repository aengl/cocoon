import fs from 'fs';
import _ from 'lodash';
import opn from 'opn';
import path from 'path';
import serializeError from 'serialize-error';
import Debug from '../common/debug';
import {
  assignPortDefinition,
  assignViewDefinition,
  CocoonDefinitions,
  CocoonDefinitionsInfo,
  createNodeDefinition,
  diffDefinitions,
  parseCocoonDefinitions,
  removeNodeDefinition,
  removePortDefinition,
  removeViewDefinition,
  updateNodesInDefinitions,
} from '../common/definitions';
import {
  createGraphFromDefinitions,
  createUniqueNodeId,
  edgesAreEqual,
  getPortData,
  Graph,
  GraphNode,
  nodeHasState,
  nodeIsCached,
  nodeNeedsProcessing,
  NodeStatus,
  requireNode,
  resolveDownstream,
  transferGraphState,
  updatePortStats,
  updateViewState,
  viewStateHasChanged,
} from '../common/graph';
import {
  deserialiseNode,
  initialiseIPC,
  onChangeNodeViewState,
  onClearPersistedCache,
  onCreateEdge,
  onCreateNode,
  onCreateView,
  onInsertColumn,
  onInsertRow,
  onOpenDefinitions,
  onOpenFile,
  onProcessNode,
  onProcessNodeIfNecessary,
  onPurgeCache,
  onQueryNodeView,
  onQueryNodeViewData,
  onRemoveEdge,
  onRemoveNode,
  onRemoveView,
  onRequestDefinitions,
  onRequestMemoryUsage,
  onRequestNodeSync,
  onRequestPortData,
  onRunProcess,
  onSyncNode,
  onUpdateDefinitions,
  sendError,
  sendSyncGraph,
  sendSyncNode,
  sendUpdateDefinitions,
  sendUpdateNodeProgress,
  serialiseGraph,
  serialiseNode,
} from '../common/ipc';
import { NodeContext, NodeRegistry } from '../common/node';
import { readFile, resolvePath, writeFile, writeYamlFile } from './fs';
import {
  clearPersistedCache,
  copyFromPort,
  nodeHasPersistedCache,
  persistIsEnabled,
  readFromPort,
  readFromPorts,
  respondToViewQuery,
  restorePersistedCache,
  updateView,
  writePersistedCache,
  writeToPort,
  writeToPorts,
} from './nodes';
import { appendToExecutionPlan, createAndExecutePlanForNodes } from './planner';
import { runProcess } from './process';
import { createNodeRegistry, getNodeObjectFromNode } from './registry';

const debug = require('../common/debug')('core:index');
const coreModules = {
  fs: require('./fs'),
  process: require('./process'),
};
const watchedFiles = new Set();
const cacheRestoration: Map<GraphNode, Promise<any>> = new Map();
let graph: Graph | null = null;
let nodeRegistry: NodeRegistry | null = null;
let definitionsInfo: CocoonDefinitionsInfo | null = null;
let previousDefinitionsInfo: CocoonDefinitionsInfo | null = null;

process.on('unhandledRejection', error => {
  throw error;
});

process.on('uncaughtException', error => {
  console.error(error.message, error);
  sendError({ error: serializeError(error) });
});

export async function openDefinitions(definitionsPath: string) {
  await parseDefinitions(definitionsPath);
}

export async function processNodeById(nodeId: string) {
  const node = requireNode(nodeId, graph!);
  await processNode(node);
}

export async function processNodeByIdIfNecessary(nodeId: string) {
  const node = requireNode(nodeId, graph!);
  await processNodeIfNecessary(node);
}

export async function processNode(node: GraphNode) {
  // Clear the node cache before creating an execution plan -- otherwise
  // nothing will happen if the node is already cached
  invalidateNodeCacheDownstream(node);
  await createAndExecutePlanForNodes(node, createNodeProcessor, graph!, {
    afterPlanning: plan => {
      // Append unprocessed hot nodes to plan
      graph!.nodes
        .filter(n => n.hot === true && n.state.status === undefined)
        .forEach(n => appendToExecutionPlan(plan, n));
    },
    nodeAdded: n => {
      n.state.scheduled = true;
      sendSyncNode({ serialisedNode: serialiseNode(n) });
    },
    nodeRemoved: n => {
      n.state.scheduled = false;
      sendSyncNode({ serialisedNode: serialiseNode(n) });
    },
  });
}

export async function processNodeIfNecessary(node: GraphNode) {
  if (nodeNeedsProcessing(node)) {
    await createAndExecutePlanForNodes(node, createNodeProcessor, graph!);
  }
}

export async function processHotNodes() {
  const unprocessedHotNodes = graph!.nodes.filter(
    n => n.hot === true && n.state.status === undefined
  );
  await createAndExecutePlanForNodes(
    unprocessedHotNodes,
    createNodeProcessor,
    graph!
  );
}

export function createNodeContext(node: GraphNode): NodeContext {
  const nodeObj = getNodeObjectFromNode(nodeRegistry!, node);
  return _.assign(
    {
      debug: Debug(`core:${node.id}`),
      definitions: definitionsInfo!,
      graph: graph!,
      node,
      ports: {
        copy: copyFromPort.bind<null, any, any>(
          null,
          nodeRegistry,
          node,
          graph!
        ),
        read: readFromPort.bind<null, any, any>(
          null,
          nodeRegistry,
          node,
          graph!
        ),
        readAll: readFromPorts.bind(
          null,
          nodeRegistry!,
          node,
          graph!,
          nodeObj.in
        ),
        write: writeToPort.bind(null, node),
        writeAll: writeToPorts.bind(null, node),
      },
      progress: _.throttle((summary, percent) => {
        // Check if the node is still processing, otherwise the delayed progress
        // report could come in after the node already finished
        if (node.state.status === NodeStatus.processing) {
          sendUpdateNodeProgress(node.id, { summary, percent });
        }
      }, 200),
    },
    coreModules
  );
}

async function createNodeProcessor(node: GraphNode) {
  if (cacheRestoration.get(node)) {
    // This node became part of an execution plan before it had the chance to
    // restore its persisted cache. Our best course of action is to wait for the
    // cache to be restored and skip the processing step, since that's the most
    // likely correct behaviour.
    await cacheRestoration.get(node);
    return;
  }

  debug(`evaluating node "${node.id}"`);
  const nodeObj = getNodeObjectFromNode(nodeRegistry!, node);

  try {
    invalidateNodeCache(node, false);

    // Update status
    node.state.status = NodeStatus.processing;
    syncNode(node);

    // Create node context
    const context = createNodeContext(node);

    // Process node
    context.debug(`processing`);
    const result = await nodeObj.process(context);
    if (result !== undefined) {
      node.state.summary = result;
    } else {
      delete node.state.summary;
    }

    // Update port stats
    updatePortStats(node);

    // Create rendering data
    await updateView(node, nodeObj, context);

    // Persist cache
    if (persistIsEnabled(nodeRegistry!, node)) {
      await writePersistedCache(node, definitionsInfo!);
    }

    // Update status and sync node
    node.state.status = NodeStatus.processed;
    syncNode(node);
  } catch (error) {
    debug(`error in node "${node.id}"`);
    // Serialisation is needed here because `debug` will attempt to send the log
    // via IPC
    debug(serializeError(error));
    node.state.error = error;
    node.state.status = NodeStatus.error;
    syncNode(node);
  }
}

function invalidateNodeCacheDownstream(node: GraphNode, sync = true) {
  const downstreamNodes = resolveDownstream(node, graph!);
  downstreamNodes.forEach(n => {
    invalidateNodeCache(n, sync);
  });
  return downstreamNodes;
}

function invalidateNodeCache(node: GraphNode, sync = true) {
  if (nodeHasState(node)) {
    debug(`invalidating "${node.id}"`);
    node.state = {};
    if (sync) {
      syncNode(node);
    }
  }
}

function invalidateViewCache(node: GraphNode, sync = true) {
  debug(`invalidating view for "${node.id}"`);
  node.state.viewData = null;
  delete node.state.viewDataId;
  if (sync) {
    syncNode(node);
  }
}

async function parseDefinitions(definitionsPath: string) {
  const resolvedDefinitionsPath = resolvePath(definitionsPath);
  const definitionsRaw = await readFile(resolvedDefinitionsPath);

  // If we already have definitions (and the path didn't change) we can attempt
  // to keep some of the cache alive
  const sameDefinitionsFile =
    definitionsInfo && definitionsInfo.path === resolvedDefinitionsPath;

  // Already save some info prior to parsing, since it might fail
  definitionsInfo = {
    path: resolvedDefinitionsPath,
    raw: definitionsRaw,
    root: path.dirname(resolvedDefinitionsPath),
  };

  // Parse definitions
  debug(`parsing Cocoon definitions file at "${resolvedDefinitionsPath}"`);
  const nextDefinitions: CocoonDefinitions = parseCocoonDefinitions(
    definitionsRaw
  ) || { nodes: {} };
  definitionsInfo.parsed = nextDefinitions;

  // Create/update the node registry if necessary
  if (!nodeRegistry || !sameDefinitionsFile) {
    nodeRegistry = await createNodeRegistry(definitionsInfo);
  }

  // Create graph & transfer state from the previous graph
  const nextGraph = createGraphFromDefinitions(
    definitionsInfo.parsed,
    nodeRegistry
  );
  if (sameDefinitionsFile && previousDefinitionsInfo && graph) {
    const diff = diffDefinitions(
      previousDefinitionsInfo.parsed!,
      nextDefinitions
    );

    // Invalidate node cache of changed nodes
    const invalidatedNodeIds = new Set<string>();
    diff.changedNodes.forEach(nodeId => {
      const changedNode = requireNode(nodeId, graph!);
      invalidateNodeCacheDownstream(changedNode, false).forEach(node => {
        invalidatedNodeIds.add(node.id);
      });
    });

    // Invalidate node cache in the new graph, since newly connected nodes are
    // no longer valid as well
    diff.changedNodes.forEach(nodeId => {
      const changedNode = nextGraph.map.get(nodeId);
      if (changedNode !== undefined) {
        invalidateNodeCacheDownstream(changedNode, false).forEach(node => {
          invalidatedNodeIds.add(node.id);
        });
      }
    });

    // Transfer state
    transferGraphState(graph, nextGraph);

    if (diff.addedNodes.length > 0 || diff.removedNodes.length > 0) {
      // If nodes were added or removed, sync the entire graph
      sendSyncGraph({
        nodeRegistry,
        serialisedGraph: serialiseGraph(nextGraph),
      });
    } else {
      // Sync all node that either
      // - had changes in their definition
      // - had changes in their edges
      nextGraph.nodes
        .map(n => ({
          next: n,
          prev: requireNode(n.id, graph!),
        }))
        .filter(
          x =>
            invalidatedNodeIds.has(x.next.id) ||
            !edgesAreEqual(x.next.edgesIn, x.prev.edgesIn) ||
            !edgesAreEqual(x.next.edgesOut, x.prev.edgesOut)
        )
        .forEach(x => {
          debug(`changes in ${x.next.id}`);
          sendSyncNode({ serialisedNode: serialiseNode(x.next) });
        });
    }
  } else {
    // Sync graph -- loading the persisted cache can take a long time, so we sync
    // the graph before and update the nodes that were restored individually
    sendSyncGraph({
      nodeRegistry,
      serialisedGraph: serialiseGraph(nextGraph),
    });

    // Restore persisted cache
    nextGraph.nodes.forEach(async node => {
      if (
        !nodeIsCached(node) &&
        nodeHasPersistedCache(node, definitionsInfo!)
      ) {
        const restore = restorePersistedCache(node, definitionsInfo!);
        cacheRestoration.set(node, restore);
        await restore;
        debug(`restored persisted cache for "${node.id}"`);
        node.state.summary = `Restored persisted cache`;
        node.state.status = NodeStatus.processed;
        updatePortStats(node);
        syncNode(node);
        cacheRestoration.delete(node);
        await updateView(
          node,
          getNodeObjectFromNode(nodeRegistry!, node),
          createNodeContext(node)
        );
      }
    });
  }

  // Commit graph and process hot nodes
  graph = nextGraph;
  previousDefinitionsInfo = _.cloneDeep(definitionsInfo);
  processHotNodes();

  return definitionsInfo;
}

async function reparseDefinitions() {
  return parseDefinitions(definitionsInfo!.path);
}

function unwatchDefinitionsFile() {
  const definitionsPath = definitionsInfo ? definitionsInfo.path : null;
  if (definitionsPath) {
    if (watchedFiles.has(definitionsPath)) {
      // debug(`removing watch for "${path}"`);
      watchedFiles.delete(definitionsPath);
      fs.unwatchFile(definitionsPath);
    }
  }
}

function watchDefinitionsFile() {
  const definitionsPath = definitionsInfo!.path;
  if (!watchedFiles.has(definitionsPath)) {
    // debug(`watching "${path}"`);
    watchedFiles.add(definitionsPath);
    fs.watchFile(definitionsPath, { interval: 500 }, async () => {
      debug(`definitions file at "${definitionsPath}" was modified`);
      await reparseDefinitions();
      // Make sure the client gets the definitions contents as well
      sendUpdateDefinitions({ definitions: definitionsInfo!.raw });
    });
  }
}

async function updateDefinitionsAndNotify() {
  debug(`updating definitions`);
  // TODO: this is a mess; the graph should just have the original definitions
  // linked, so this entire step should be redundant!
  updateNodesInDefinitions(definitionsInfo!.parsed!, nodeId => {
    const node = graph!.map.get(nodeId);
    return node ? node.definition : node;
  });
  unwatchDefinitionsFile();
  const definitions = await writeYamlFile(
    definitionsInfo!.path,
    definitionsInfo!.parsed,
    { debug }
  );
  watchDefinitionsFile();

  // Notify the client that the definition changed
  sendUpdateDefinitions({ definitions });

  return definitions;
}

function syncNode(node: GraphNode) {
  node.syncId = Date.now();
  sendSyncNode({ serialisedNode: serialiseNode(node) });
}

// Run IPC server and register IPC events
initialiseIPC().then(() => {
  onOpenDefinitions(async args => {
    debug(`opening definitions file at "${args.definitionsPath}"`);
    unwatchDefinitionsFile();

    // Reset state to force a complete graph re-construction
    definitionsInfo = null;
    graph = null;
    nodeRegistry = null;

    try {
      await parseDefinitions(args.definitionsPath);
    } catch (error) {
      throw error;
    } finally {
      // Make sure the client gets the definitions contents as well
      sendUpdateDefinitions({ definitions: definitionsInfo!.raw });
      watchDefinitionsFile();
    }
  });

  onUpdateDefinitions(async args => {
    if (args.definitions) {
      // The client updated the definitions file manually (via the text editor)
      // -- persist the changes and re-build the graph
      unwatchDefinitionsFile();
      await writeFile(definitionsInfo!.path, args.definitions);
      watchDefinitionsFile();
      reparseDefinitions();
    } else {
      updateDefinitionsAndNotify();
    }
  });

  onRequestDefinitions(() => ({
    definitions: definitionsInfo ? definitionsInfo.raw : undefined,
  }));

  onProcessNode(args => {
    const { nodeId } = args;
    processNodeById(nodeId);
  });

  onProcessNodeIfNecessary(args => {
    const { nodeId } = args;
    processNodeByIdIfNecessary(nodeId);
  });

  onRequestPortData(async args => {
    const { nodeId, port } = args;
    const node = requireNode(nodeId, graph!);
    // debug(`got port data request from "${node.id}"`);
    if (!nodeIsCached(node)) {
      await processNode(node);
    }
    return { data: getPortData(node, port, graph!) };
  });

  // Sync attribute changes in nodes (i.e. the UI changed a node's state). The
  // editor only sends this event when it only expects the core to persist the
  // changes and nothing else (e.g. changing a node's position). Therefore, the
  // definitions are not parsed again.
  onSyncNode(args => {
    const { serialisedNode } = args;
    const node = requireNode(_.get(serialisedNode, 'id'), graph!);
    debug(`syncing node "${node.id}"`);
    _.assign(node, deserialiseNode(serialisedNode));
  });

  onRequestNodeSync(args => {
    const { nodeId, syncId } = args;
    if (graph) {
      // Ignore request if there's no graph, since data views will send these
      // requests regardless
      const node = requireNode(nodeId, graph);
      if (syncId === undefined || syncId !== node.syncId) {
        syncNode(node);
      }
    }
  });

  // If the node view state changes (due to interacting with the data view
  // window of a node), re-processes the node
  onChangeNodeViewState(args => {
    const { nodeId, state } = args;
    const node = requireNode(nodeId, graph!);
    if (viewStateHasChanged(node, state)) {
      updateViewState(node, state);
      debug(`view state changed for "${node.id}"`);
      processNode(node);

      // Write changes back to definitions
      updateDefinitionsAndNotify();
    }
  });

  onQueryNodeView(args => {
    const { nodeId, query } = args;
    const node = requireNode(nodeId, graph!);
    const context = createNodeContext(node);
    return respondToViewQuery(node, context, query);
  });

  onQueryNodeViewData(args => {
    const { nodeId } = args;
    const node = requireNode(nodeId, graph!);
    return { viewData: node.state.viewData };
  });

  onCreateNode(async args => {
    const { type, gridPosition, edge } = args;
    debug(`creating new node of type "${type}"`);
    const nodeId = createUniqueNodeId(graph!, type);
    const nodeDefinition = createNodeDefinition(
      definitionsInfo!.parsed!,
      type,
      nodeId,
      gridPosition
    );
    if (edge !== undefined) {
      if (edge.fromNodeId === undefined) {
        // Create outgoing edge
        assignPortDefinition(
          requireNode(edge.toNodeId!, graph!).definition,
          edge.toNodePort,
          nodeId,
          edge.fromNodePort
        );
      } else {
        // Create incoming edge
        assignPortDefinition(
          nodeDefinition,
          edge.toNodePort,
          edge.fromNodeId,
          edge.fromNodePort
        );
      }
    }
    await updateDefinitionsAndNotify();
    await reparseDefinitions();
  });

  onRemoveNode(async args => {
    const { nodeId } = args;
    const node = requireNode(nodeId, graph!);
    if (node.edgesOut.length === 0) {
      debug(`removing node "${nodeId}"`);
      removeNodeDefinition(definitionsInfo!.parsed!, nodeId);
      await updateDefinitionsAndNotify();
      await reparseDefinitions();
    } else {
      debug(`can't remove node "${nodeId}" because it has outgoing edges`);
    }
  });

  onCreateEdge(async args => {
    const { fromNodeId, fromNodePort, toNodeId, toNodePort } = args;
    debug(
      `creating new edge "${fromNodeId}/${fromNodePort} -> ${toNodeId}/${toNodePort}"`
    );
    const toNode = requireNode(toNodeId, graph!);
    assignPortDefinition(
      toNode.definition,
      toNodePort,
      fromNodeId,
      fromNodePort
    );
    await updateDefinitionsAndNotify();
    await reparseDefinitions();
    invalidateNodeCacheDownstream(toNode);
  });

  onRemoveEdge(async args => {
    const { nodeId, port } = args;
    const node = requireNode(nodeId, graph!);
    invalidateNodeCacheDownstream(node);
    if (port.incoming) {
      debug(`removing edge to "${nodeId}/${port}"`);
      removePortDefinition(node.definition, port.name);
    } else {
      // TODO: remove all connected edges
    }
    await updateDefinitionsAndNotify();
    await reparseDefinitions();
  });

  onClearPersistedCache(async args => {
    const { nodeId } = args;
    const node = requireNode(nodeId, graph!);
    clearPersistedCache(node, definitionsInfo!);
  });

  onCreateView(async args => {
    const { nodeId, type, port } = args;
    debug(`creating new view of type "${type}"`);
    const node = requireNode(nodeId, graph!);
    invalidateViewCache(node);
    assignViewDefinition(node.definition, type, port);
    await updateDefinitionsAndNotify();
    await reparseDefinitions();
    await processNodeById(args.nodeId);
  });

  onRemoveView(async args => {
    const { nodeId } = args;
    debug(`removing view for "${nodeId}"`);
    const node = requireNode(nodeId, graph!);
    invalidateViewCache(node);
    removeViewDefinition(node.definition);
    await updateDefinitionsAndNotify();
    await reparseDefinitions();
  });

  onRequestMemoryUsage(() => ({
    memoryUsage: process.memoryUsage(),
    process: 'core',
  }));

  onRunProcess(args => {
    runProcess(args.command, {
      args: args.args,
      cwd: definitionsInfo!.root,
    });
  });

  onPurgeCache(() => {
    graph!.nodes
      .filter(node => nodeIsCached(node))
      .forEach(node => invalidateNodeCache(node));
  });

  onInsertColumn(async args => {
    graph!.nodes
      .filter(node => !_.isNil(node.definition.editor))
      .filter(node => !_.isNil(node.definition.editor!.col))
      .filter(node => node.definition.editor!.col! >= args.beforeColumn)
      .forEach(node => {
        node.definition.editor!.col! += 1;
      });
    await updateDefinitionsAndNotify();
    await reparseDefinitions();
  });

  onInsertRow(async args => {
    graph!.nodes
      .filter(node => !_.isNil(node.definition.editor))
      .filter(node => !_.isNil(node.definition.editor!.row))
      .filter(node => node.definition.editor!.row! >= args.beforeRow)
      .forEach(node => {
        node.definition.editor!.row! += 1;
      });
    await updateDefinitionsAndNotify();
    await reparseDefinitions();
  });

  onOpenFile(args => {
    opn(args.uri);
  });

  // Respond to IPC messages
  process.on('message', m => {
    if (m === 'close') {
      process.exit(0);
    }
  });

  // Emit ready signal
  if (process.send) {
    process.send('ready');
  }
});
