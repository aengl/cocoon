import fs from 'fs';
import _ from 'lodash';
import serializeError from 'serialize-error';
import Debug from '../common/debug';
import {
  assignPortDefinition,
  assignViewDefinition,
  CocoonDefinitions,
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
  findPath,
  getPortData,
  GraphNode,
  nodeHasState,
  nodeIsCached,
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
import { NodeContext } from '../common/node';
import { getView } from '../common/views';
import { readFile, resolveDirectory, resolvePath, writeYamlFile } from './fs';
import {
  clearPersistedCache,
  cloneFromPort,
  persistIsEnabled,
  readFromPort,
  restorePersistedCache,
  writePersistedCache,
  writeToPort,
} from './nodes';
import { runProcess } from './process';
import { createNodeRegistry, getNodeObjectFromNode } from './registry';

const debug = Debug('core:index');
const corefs = require('./fs');
const watchedFiles = new Set();
const nodeProcessors = new Map<string, Promise<void>>();
let cacheRestoration: Promise<any> | null = null;

process.on('unhandledRejection', error => {
  throw error;
});

process.on('uncaughtException', error => {
  console.error(error);
  sendError({ error: serializeError(error) });
});

export async function processNodeById(nodeId: string) {
  const { graph } = global;
  const node = requireNode(nodeId, graph);
  return processNode(node);
}

export async function processNode(node: GraphNode) {
  // Clear downstream cache
  invalidateNodeCache(node);

  // Figure out the evaluation path
  debug(`running graph to generate results for node "${node.id}"`);
  const path = findPath(node, n => !nodeIsCached(n));
  if (path.length === 0) {
    // If all upstream nodes are cached or the node is a starting node, the path
    // will be an empty array. In that case, process the target node only.
    path.push(node);
  }
  if (path.length > 1) {
    debug(path.map(n => n.id).join(' -> '));
  }

  // Process nodes
  debug(`processing ${path.length} nodes`);
  for (const n of path) {
    await createNodeProcessor(n);
  }

  // Process affected hot nodes
  processHotNodes();
}

async function createNodeProcessor(node: GraphNode) {
  if (cacheRestoration !== null) {
    // Wait for persisted cache to be restored first
    await cacheRestoration;
  }
  const existingProcessor = nodeProcessors.get(node.id);
  if (existingProcessor !== undefined) {
    // If this node is already being processed, re-use the existing processor to
    // make sure the node isn't evaluated multiple times in parallel
    await existingProcessor;
  } else {
    const processor = processSingleNode(node);
    nodeProcessors.set(node.id, processor);
    await processor;
    nodeProcessors.delete(node.id);
  }
}

async function processSingleNode(node: GraphNode) {
  const existingProcessor = nodeProcessors.get(node.id);
  if (existingProcessor !== undefined) {
    debug(`node "${node.id}" is already being processed`);
    return existingProcessor;
  }

  debug(`evaluating node "${node.id}"`);
  const nodeObj = getNodeObjectFromNode(global.nodeRegistry, node);

  try {
    invalidateSingleNodeCache(node, false);

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
      }
    }

    // Persist cache
    if (persistIsEnabled(global.nodeRegistry, node)) {
      await writePersistedCache(node);
    }

    // Update status and sync node
    node.state.status = nodeIsCached(node)
      ? NodeStatus.cached
      : NodeStatus.processed;
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

export async function processHotNodes() {
  const { graph } = global;
  const unprocessedHotNode = graph.nodes.find(
    node => node.hot === true && node.state.status === undefined
  );
  if (unprocessedHotNode !== undefined) {
    await processNode(unprocessedHotNode);
    processHotNodes();
  }
}

export function invalidateNodeCache(node: GraphNode, sync = true) {
  const downstreamNodes = resolveDownstream(node);
  downstreamNodes.forEach(n => {
    invalidateSingleNodeCache(n, sync);
  });
}

export function invalidateSingleNodeCache(node: GraphNode, sync = true) {
  if (nodeHasState(node)) {
    debug(`invalidating "${node.id}"`);
    node.state = {};
    if (sync) {
      sendNodeSync({ serialisedNode: serialiseNode(node) });
    }
  }
}

export function invalidateViewCache(node: GraphNode, sync = true) {
  debug(`invalidating view for "${node.id}"`);
  node.state.viewData = null;
  if (sync) {
    sendNodeSync({ serialisedNode: serialiseNode(node) });
  }
}

export function createNodeContext(node: GraphNode): NodeContext {
  return {
    cloneFromPort: cloneFromPort.bind<null, any, any>(
      null,
      global.nodeRegistry,
      node
    ),
    debug: Debug(`core:${node.id}`),
    definitions: global.definitions,
    definitionsRoot: global.definitionsRoot,
    fs: corefs,
    node,
    progress: (summary, percent) => {
      sendNodeProgress(node.id, { summary, percent });
    },
    readFromPort: readFromPort.bind<null, any, any>(
      null,
      global.nodeRegistry,
      node
    ),
    writeToPort: writeToPort.bind(null, node),
  };
}

async function parseDefinitions(definitionsPath: string) {
  const resolvedDefinitionsPath = resolvePath(definitionsPath);
  const nextDefinitions: CocoonDefinitions = parseCocoonDefinitions(
    await readFile(resolvedDefinitionsPath)
  ) || { nodes: {} };
  const previousDefinitions = global.definitions;
  debug(`parsing Cocoon definitions file at "${resolvedDefinitionsPath}"`);

  // If we already have definitions (and the path didn't change) we can attempt
  // to keep some of the cache alive
  const keepCache =
    previousDefinitions !== undefined &&
    global.definitionsPath === resolvedDefinitionsPath;

  // Apply new definitions
  global.definitionsPath = resolvedDefinitionsPath;
  global.definitionsRoot = resolveDirectory(resolvedDefinitionsPath);
  global.definitions = nextDefinitions;

  // Create/update the node registry if necessary
  if (!global.nodeRegistry || !keepCache) {
    global.nodeRegistry = await createNodeRegistry(global.definitionsPath);
  }

  // Create graph
  const nextGraph = createGraphFromDefinitions(
    global.definitions,
    global.nodeRegistry
  );
  const previousGraph = global.graph;
  global.graph = nextGraph;

  // Transfer state from the previous graph
  if (keepCache) {
    const diff = diffDefinitions(previousDefinitions, nextDefinitions);

    // Invalidate node cache of changed nodes
    diff.changedNodes.forEach(nodeId => {
      const changedNode = requireNode(nodeId, previousGraph);
      invalidateNodeCache(changedNode, false);
    });

    // Transfer state
    transferGraphState(previousGraph, nextGraph);

    // Invalidate node cache in the new graph, since newly connected nodes are
    // no longer valid as well
    diff.changedNodes.forEach(nodeId => {
      const changedNode = nextGraph.map.get(nodeId);
      if (changedNode !== undefined) {
        invalidateNodeCache(changedNode, false);
      }
    });
  }

  // Sync graph -- loading the persisted cache can take a long time, so we sync
  // the graph before and update the nodes that were restored individually
  sendGraphSync({
    definitionsPath: resolvedDefinitionsPath,
    nodeRegistry: global.nodeRegistry,
    serialisedGraph: serialiseGraph(nextGraph),
  });

  // Restore persisted cache
  cacheRestoration = Promise.all(
    nextGraph.nodes.map(async node => {
      if ((await restorePersistedCache(node)) !== undefined) {
        debug(`restored persisted cache for "${node.id}"`);
        node.state.summary = `Restored persisted cache`;
        node.state.status = NodeStatus.cached;
        updatePortStats(node);
        sendNodeSync({ serialisedNode: serialiseNode(node) });
      }
    })
  );
  await cacheRestoration;
  cacheRestoration = null;

  // Process hot nodes
  processHotNodes();
}

async function reparseDefinitions() {
  return parseDefinitions(global.definitionsPath);
}

function unwatchDefinitionsFile() {
  const { definitionsPath } = global;
  if (definitionsPath) {
    const resolvedPath = resolvePath(definitionsPath);
    if (watchedFiles.has(resolvedPath)) {
      // debug(`removing watch for "${resolvedPath}"`);
      watchedFiles.delete(resolvedPath);
      fs.unwatchFile(resolvedPath);
    }
  }
}

function watchDefinitionsFile() {
  const { definitionsPath } = global;
  if (!watchedFiles.has(definitionsPath)) {
    // debug(`watching "${definitionsPath}"`);
    watchedFiles.add(definitionsPath);
    fs.watchFile(definitionsPath, { interval: 500 }, () => {
      debug(`definitions file at "${definitionsPath}" was modified`);
      reparseDefinitions();
    });
  }
}

async function updateDefinitions() {
  debug(`updating definitions`);
  const { definitions, graph } = global;
  // TODO: this is a mess; the graph should just have the original definitions
  // linked, so this entire step should be redundant!
  updateNodesInDefinitions(definitions, nodeId => {
    const node = graph.map.get(nodeId);
    return node ? node.definition : node;
  });
  unwatchDefinitionsFile();
  const definitionsContent = await writeYamlFile(
    global.definitionsPath,
    definitions,
    undefined,
    debug
  );
  watchDefinitionsFile();
  return definitionsContent;
}

// Run IPC server and register IPC events
initialiseIPC().then(() => {
  onOpenDefinitions(async args => {
    debug(`opening definitions file`);

    // Delete global state to force a complete graph re-construction
    delete global.definitionsPath;
    delete global.definitionsRoot;
    delete global.definitions;
    delete global.graph;
    delete global.nodeRegistry;

    unwatchDefinitionsFile();
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

  onPortDataRequest(async args => {
    const { nodeId, port } = args;
    const node = requireNode(nodeId, global.graph);
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
    const { graph } = global;
    const { serialisedNode } = args;
    const node = requireNode(_.get(serialisedNode, 'id'), graph);
    debug(`syncing node "${node.id}"`);
    updateNode(node, serialisedNode);
  });

  onRequestNodeSync(args => {
    const { graph } = global;
    const { nodeId, syncId } = args;
    const node = requireNode(nodeId, graph);
    if (syncId === undefined || syncId !== node.syncId) {
      sendNodeSync({ serialisedNode: serialiseNode(node) });
    }
  });

  // If the node view state changes (due to interacting with the data view window
  // of a node), re-processes the node
  onNodeViewStateChanged(args => {
    const { nodeId, state } = args;
    const node = requireNode(nodeId, global.graph);
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
    const node = requireNode(nodeId, global.graph);
    if (node.view !== undefined) {
      debug(`got view query from "${node.id}"`);
      const viewObj = getView(node.view);
      if (viewObj.respondToQuery === undefined) {
        throw new Error(`View "${node.view}" doesn't define a query response`);
      }
      const context = createNodeContext(node);
      const data = viewObj.respondToQuery(context, query);
      return { data };
    }
    return {};
  });

  onCreateNode(async args => {
    const { definitions, definitionsPath, graph } = global;
    const { type, gridPosition, edge } = args;
    debug(`creating new node of type "${type}"`);
    const nodeId = createUniqueNodeId(graph, type);
    const nodeDefinition = createNodeDefinition(
      definitions,
      type,
      nodeId,
      gridPosition ? gridPosition.col : undefined,
      gridPosition ? gridPosition.row : undefined
    );
    if (edge !== undefined) {
      if (edge.fromNodeId === undefined) {
        // Create outgoing edge
        assignPortDefinition(
          requireNode(edge.toNodeId!, graph).definition,
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
    const { definitions, graph } = global;
    const { nodeId } = args;
    const node = requireNode(nodeId, graph);
    if (node.edgesOut.length === 0) {
      debug(`removing node "${nodeId}"`);
      removeNodeDefinition(definitions, nodeId);
      await updateDefinitions();
      await reparseDefinitions();
    } else {
      debug(`can't remove node "${nodeId}" because it has outgoing edges`);
    }
  });

  onCreateEdge(async args => {
    const { graph } = global;
    const { fromNodeId, fromNodePort, toNodeId, toNodePort } = args;
    debug(
      `creating new edge "${fromNodeId}/${fromNodePort} -> ${toNodeId}/${toNodePort}"`
    );
    const toNode = requireNode(toNodeId, graph);
    assignPortDefinition(
      toNode.definition,
      toNodePort,
      fromNodeId,
      fromNodePort
    );
    await updateDefinitions();
    await reparseDefinitions();
    invalidateNodeCache(toNode);
  });

  onRemoveEdge(async args => {
    const { graph } = global;
    const { nodeId, port } = args;
    const node = requireNode(nodeId, graph);
    invalidateNodeCache(node);
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
    const { graph } = global;
    const { nodeId } = args;
    const node = requireNode(nodeId, graph);
    clearPersistedCache(node);
  });

  onCreateView(async args => {
    const { graph } = global;
    const { nodeId, type, port } = args;
    debug(`creating new view of type "${type}"`);
    const node = requireNode(nodeId, graph);
    invalidateViewCache(node);
    assignViewDefinition(node.definition, type, port);
    await updateDefinitions();
    await reparseDefinitions();
  });

  onRemoveView(async args => {
    const { graph } = global;
    const { nodeId } = args;
    debug(`removing view for "${nodeId}"`);
    const node = requireNode(nodeId, graph);
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
    const { definitionsRoot } = global;
    runProcess(args.command, args.args, definitionsRoot);
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
