import fs from 'fs';
import _ from 'lodash';
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
} from '../common/graph';
import {
  initialiseIPC,
  onClearPersistedCache,
  onCreateEdge,
  onCreateNode,
  onCreateView,
  onMemoryUsageRequest,
  onNodeSync,
  onNodeViewQuery,
  onNodeViewStateChanged,
  onOpenDefinitions,
  onPortDataRequest,
  onProcessNode,
  onProcessNodeIfNecessary,
  onRemoveEdge,
  onRemoveNode,
  onRemoveView,
  onRequestNodeSync,
  onRunProcess,
  onUpdateDefinitions,
  sendError,
  sendGraphSync,
  sendNodeProgress,
  sendNodeSync,
  serialiseGraph,
  serialiseNode,
  updateNode,
} from '../common/ipc';
import { NodeContext, NodeRegistry } from '../common/node';
import { getView } from '../common/views';
import { readFile, resolveDirectory, resolvePath, writeYamlFile } from './fs';
import {
  clearPersistedCache,
  cloneFromPort,
  nodeHasPersistedCache,
  persistIsEnabled,
  readFromPort,
  restorePersistedCache,
  writePersistedCache,
  writeToPort,
} from './nodes';
import {
  appendToExecutionPlan,
  createAndExecutePlanForNode,
  createAndExecutePlanForNodes,
} from './planner';
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

process.on('unhandledRejection', error => {
  throw error;
});

process.on('uncaughtException', error => {
  console.error(error.message, error);
  sendError({ error: serializeError(error) });
});

export async function processNodeById(nodeId: string) {
  const node = requireNode(nodeId, graph!);
  await processNode(node);
}

export async function processNodeByIdIfNecessary(nodeId: string) {
  const node = requireNode(nodeId, graph!);
  await processNodeIfNecessary(node);
}

export async function processNode(node: GraphNode) {
  await createAndExecutePlanForNode(node, createNodeProcessor, {
    afterPlanning: plan => {
      // Append unprocessed hot nodes to plan
      graph!.nodes
        .filter(n => n.hot === true && n.state.status === undefined)
        .forEach(n => appendToExecutionPlan(plan, n));
    },
    beforePlanning: () => {
      // Clear the node cache before creating an execution plan -- otherwise
      // nothing will happen if the node is already cached
      invalidateNodeCacheDownstream(node);
    },
  });
}

export async function processNodeIfNecessary(node: GraphNode) {
  if (nodeNeedsProcessing(node)) {
    await createAndExecutePlanForNode(node, createNodeProcessor);
  }
}

export async function processHotNodes() {
  const unprocessedHotNodes = graph!.nodes.filter(
    n => n.hot === true && n.state.status === undefined
  );
  await createAndExecutePlanForNodes(unprocessedHotNodes, createNodeProcessor);
}

export function createNodeContext(node: GraphNode): NodeContext {
  return _.assign(
    {
      cloneFromPort: cloneFromPort.bind<null, any, any>(
        null,
        nodeRegistry,
        node
      ),
      debug: Debug(`core:${node.id}`),
      definitions: definitionsInfo!,
      node,
      progress: (summary, percent) => {
        sendNodeProgress(node.id, { summary, percent });
      },
      readFromPort: readFromPort.bind<null, any, any>(null, nodeRegistry, node),
      writeToPort: writeToPort.bind(null, node),
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
    sendNodeSync({ serialisedNode: serialiseNode(node) });

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
    if (node.view !== undefined) {
      const viewObj = getView(node.view);
      node.viewPort = node.viewPort ||
        // Fall back to default port
        viewObj.defaultPort ||
        nodeObj.defaultPort || {
          incoming: false,
          name: 'data',
        };
      const data = getPortData(node, node.viewPort);
      if (data !== undefined) {
        context.debug(`serialising rendering data "${node.view}"`);
        node.state.viewData =
          viewObj.serialiseViewData === undefined
            ? data
            : await viewObj.serialiseViewData(
                context,
                data,
                node.definition.viewState || {}
              );
        node.state.viewDataId = Date.now();
      }
    }

    // Persist cache
    if (persistIsEnabled(nodeRegistry!, node)) {
      await writePersistedCache(node, definitionsInfo!);
    }

    // Update status and sync node
    node.state.status = NodeStatus.processed;
    sendNodeSync({ serialisedNode: serialiseNode(node) });
  } catch (error) {
    debug(`error in node "${node.id}"`);
    // Serialisation is needed here because `debug` will attempt to send the log
    // via IPC
    debug(serializeError(error));
    node.state.error = error;
    node.state.status = NodeStatus.error;
    sendNodeSync({ serialisedNode: serialiseNode(node) });
  }
}

function invalidateNodeCacheDownstream(node: GraphNode, sync = true) {
  const downstreamNodes = resolveDownstream(node);
  downstreamNodes.forEach(n => {
    invalidateNodeCache(n, sync);
  });
}

function invalidateNodeCache(node: GraphNode, sync = true) {
  if (nodeHasState(node)) {
    debug(`invalidating "${node.id}"`);
    node.state = {};
    if (sync) {
      sendNodeSync({ serialisedNode: serialiseNode(node) });
    }
  }
}

function invalidateViewCache(node: GraphNode, sync = true) {
  debug(`invalidating view for "${node.id}"`);
  node.state.viewData = null;
  if (sync) {
    sendNodeSync({ serialisedNode: serialiseNode(node) });
  }
}

async function parseDefinitions(definitionsPath: string) {
  const resolvedDefinitionsPath = resolvePath(definitionsPath);
  const nextDefinitions: CocoonDefinitions = parseCocoonDefinitions(
    await readFile(resolvedDefinitionsPath)
  ) || { nodes: {} };
  debug(`parsing Cocoon definitions file at "${resolvedDefinitionsPath}"`);

  // If we already have definitions (and the path didn't change) we can attempt
  // to keep some of the cache alive
  const keepCache =
    definitionsInfo && definitionsInfo.path === resolvedDefinitionsPath;

  // Apply new definitions
  const previousDefinitions = definitionsInfo ? definitionsInfo.contents : null;
  definitionsInfo = {
    contents: nextDefinitions,
    path: resolvedDefinitionsPath,
    root: resolveDirectory(resolvedDefinitionsPath),
  };

  // Create/update the node registry if necessary
  if (!nodeRegistry || !keepCache) {
    nodeRegistry = await createNodeRegistry(definitionsInfo);
  }

  // Create graph & transfer state from the previous graph
  const nextGraph = createGraphFromDefinitions(
    definitionsInfo.contents,
    nodeRegistry
  );
  if (keepCache && previousDefinitions && graph) {
    const diff = diffDefinitions(previousDefinitions, nextDefinitions);

    // Invalidate node cache of changed nodes
    diff.changedNodes.forEach(nodeId => {
      const changedNode = requireNode(nodeId, graph!);
      invalidateNodeCacheDownstream(changedNode, false);
    });

    // Transfer state
    transferGraphState(graph, nextGraph);

    // Invalidate node cache in the new graph, since newly connected nodes are
    // no longer valid as well
    diff.changedNodes.forEach(nodeId => {
      const changedNode = nextGraph.map.get(nodeId);
      if (changedNode !== undefined) {
        invalidateNodeCacheDownstream(changedNode, false);
      }
    });
  }
  graph = nextGraph;

  // Sync graph -- loading the persisted cache can take a long time, so we sync
  // the graph before and update the nodes that were restored individually
  sendGraphSync({
    nodeRegistry,
    serialisedGraph: serialiseGraph(nextGraph),
  });

  // Restore persisted cache
  nextGraph.nodes.forEach(async node => {
    if (nodeHasPersistedCache(node, definitionsInfo!)) {
      const restore = restorePersistedCache(node, definitionsInfo!);
      cacheRestoration.set(node, restore);
      await restore;
      debug(`restored persisted cache for "${node.id}"`);
      node.state.summary = `Restored persisted cache`;
      node.state.status = NodeStatus.processed;
      updatePortStats(node);
      sendNodeSync({ serialisedNode: serialiseNode(node) });
      cacheRestoration.delete(node);
    }
  });

  // Process hot nodes
  processHotNodes();
}

async function reparseDefinitions() {
  return parseDefinitions(definitionsInfo!.path);
}

function unwatchDefinitionsFile() {
  const path = definitionsInfo ? definitionsInfo.path : null;
  if (path) {
    if (watchedFiles.has(path)) {
      // debug(`removing watch for "${path}"`);
      watchedFiles.delete(path);
      fs.unwatchFile(path);
    }
  }
}

function watchDefinitionsFile() {
  const path = definitionsInfo!.path;
  if (!watchedFiles.has(path)) {
    // debug(`watching "${path}"`);
    watchedFiles.add(path);
    fs.watchFile(path, { interval: 500 }, () => {
      debug(`definitions file at "${path}" was modified`);
      reparseDefinitions();
    });
  }
}

async function updateDefinitions() {
  debug(`updating definitions`);
  // TODO: this is a mess; the graph should just have the original definitions
  // linked, so this entire step should be redundant!
  updateNodesInDefinitions(definitionsInfo!.contents, nodeId => {
    const node = graph!.map.get(nodeId);
    return node ? node.definition : node;
  });
  unwatchDefinitionsFile();
  const definitionsContent = await writeYamlFile(
    definitionsInfo!.path,
    definitionsInfo!.contents,
    { debug }
  );
  watchDefinitionsFile();
  return definitionsContent;
}

// Run IPC server and register IPC events
initialiseIPC().then(() => {
  onOpenDefinitions(async args => {
    debug(`opening definitions file`);
    unwatchDefinitionsFile();

    // Reset state to force a complete graph re-construction
    definitionsInfo = null;
    graph = null;
    nodeRegistry = null;

    await parseDefinitions(args.definitionsPath);
    watchDefinitionsFile();
  });

  onUpdateDefinitions(() => {
    updateDefinitions();
  });

  onProcessNode(args => {
    const { nodeId } = args;
    processNodeById(nodeId);
  });

  onProcessNodeIfNecessary(args => {
    const { nodeId } = args;
    processNodeByIdIfNecessary(nodeId);
  });

  onPortDataRequest(async args => {
    const { nodeId, port } = args;
    const node = requireNode(nodeId, graph!);
    debug(`got port data request from "${node.id}"`);
    if (!nodeIsCached(node)) {
      await processNode(node);
    }
    return { data: getPortData(node, port) };
  });

  // Sync attribute changes in nodes (i.e. the UI changed a node's state). The
  // editor only sends this event when it only expects the core to persist the
  // changes and nothing else (e.g. changing a node's position). Therefore, the
  // definitions are not parsed again.
  onNodeSync(args => {
    const { serialisedNode } = args;
    const node = requireNode(_.get(serialisedNode, 'id'), graph!);
    debug(`syncing node "${node.id}"`);
    updateNode(node, serialisedNode);
  });

  onRequestNodeSync(args => {
    const { nodeId, syncId } = args;
    const node = requireNode(nodeId, graph!);
    if (syncId === undefined || syncId !== node.syncId) {
      sendNodeSync({ serialisedNode: serialiseNode(node) });
    }
  });

  // If the node view state changes (due to interacting with the data view window
  // of a node), re-processes the node
  onNodeViewStateChanged(args => {
    const { nodeId, state } = args;
    const node = requireNode(nodeId, graph!);
    // TODO: `isEqual` isn't the right comparison for states in general, we want
    // to treat `null` as `undefined`. Probably best to make a dedicated state
    // comparison function.
    if (!_.isEqual(state, node.definition.viewState)) {
      updateViewState(node, state);
      debug(`view state changed for "${node.id}"`);
      processNode(node);

      // Write changes back to definitions
      updateDefinitions();
    }
  });

  onNodeViewQuery(args => {
    const { nodeId, query } = args;
    const node = requireNode(nodeId, graph!);
    if (node.view !== undefined) {
      debug(`got view query from "${node.id}"`);
      const viewObj = getView(node.view);
      if (viewObj.respondToQuery === undefined) {
        throw new Error(`View "${node.view}" doesn't define a query response`);
      }
      const context = createNodeContext(node);
      const viewPortData = getPortData(node, node.viewPort!);
      const data = viewObj.respondToQuery(context, viewPortData, query);
      return { data };
    }
    return {};
  });

  onCreateNode(async args => {
    const { type, gridPosition, edge } = args;
    debug(`creating new node of type "${type}"`);
    const nodeId = createUniqueNodeId(graph!, type);
    const nodeDefinition = createNodeDefinition(
      definitionsInfo!.contents,
      type,
      nodeId,
      gridPosition ? gridPosition.col : undefined,
      gridPosition ? gridPosition.row : undefined
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
    await updateDefinitions();
    await reparseDefinitions();
  });

  onRemoveNode(async args => {
    const { nodeId } = args;
    const node = requireNode(nodeId, graph!);
    if (node.edgesOut.length === 0) {
      debug(`removing node "${nodeId}"`);
      removeNodeDefinition(definitionsInfo!.contents, nodeId);
      await updateDefinitions();
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
    await updateDefinitions();
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
    await updateDefinitions();
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
    await updateDefinitions();
    await reparseDefinitions();
  });

  onRemoveView(async args => {
    const { nodeId } = args;
    debug(`removing view for "${nodeId}"`);
    const node = requireNode(nodeId, graph!);
    invalidateViewCache(node);
    removeViewDefinition(node.definition);
    await updateDefinitions();
    await reparseDefinitions();
  });

  onMemoryUsageRequest(() => ({
    memoryUsage: process.memoryUsage(),
    process: 'core',
  }));

  onRunProcess(args => {
    runProcess(args.command, args.args, definitionsInfo!.root);
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
