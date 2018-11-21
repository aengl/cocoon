import fs from 'fs';
import _ from 'lodash';
import serializeError from 'serialize-error';
import Debug from '../common/debug';
import {
  assignPortDefinition,
  assignViewDefinition,
  assignViewState,
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
  nodeIsCached,
  NodeStatus,
  requireNode,
  resolveDownstream,
  transferGraphState,
  updateViewState,
} from '../common/graph';
import {
  onCreateEdge,
  onCreateNode,
  onCreateView,
  onEvaluateNode,
  onMemoryUsageRequest,
  onNodeSync,
  onNodeViewQuery,
  onNodeViewStateChanged,
  onOpenDefinitions,
  onPortDataRequest,
  onRemoveEdge,
  onRemoveNode,
  onRemoveView,
  onUpdateDefinitions,
  sendError,
  sendGraphSync,
  sendNodeProgress,
  sendNodeSync,
  serialiseGraph,
  serialiseNode,
  updateNode,
} from '../common/ipc';
import { getView } from '../common/views';
import { readFile, writeYamlFile } from './fs';
import {
  cloneFromPort,
  getNode,
  NodeContext,
  readFromPort,
  writeToPort,
} from './nodes';

const debug = Debug('core:index');

process.on('unhandledRejection', e => {
  throw e;
});

process.on('uncaughtException', error => {
  console.error(error);
  sendError({ error: serializeError(error) });
});

export async function evaluateNodeById(nodeId: string) {
  const { graph } = global;
  const targetNode = requireNode(nodeId, graph);
  return evaluateNode(targetNode);
}

export async function evaluateNode(targetNode: GraphNode) {
  // Figure out the evaluation path
  debug(`running graph to generate results for node "${targetNode.id}"`);
  const path = findPath(targetNode);
  if (path.length === 0) {
    // If all upstream nodes are cached or the node is a starting node, the path
    // will be an empty array. In that case, re-evaluate the target node only.
    path.push(targetNode);
  }
  if (path.length > 1) {
    debug(path.map(n => n.id).join(' -> '));
  }

  // Clear downstream cache
  invalidateNodeCache(targetNode);

  // Process nodes
  debug(`processing ${path.length} nodes`);
  for (const node of path) {
    await evaluateSingleNode(node);
  }

  // Re-evaluate affected hot nodes
  evaluateHotNodes();
}

async function evaluateSingleNode(node: GraphNode) {
  debug(`evaluating node "${node.id}"`);
  const nodeObj = getNode(node.type);
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
            : viewObj.serialiseViewData(context, data, node.viewState || {});
      }
    }

    // Update status and sync node
    node.state.status = nodeIsCached(node)
      ? NodeStatus.cached
      : NodeStatus.processed;
    sendNodeSync({ serialisedNode: serialiseNode(node) });
  } catch (error) {
    debug(`error in node "${node.id}"`);
    debug(error);
    node.state.error = error;
    node.state.status = NodeStatus.error;
    sendNodeSync({ serialisedNode: serialiseNode(node) });
  }
}

export async function evaluateHotNodes() {
  const { graph } = global;
  const unprocessedHotNode = graph.nodes.find(
    node => node.hot === true && node.state === null
  );
  if (unprocessedHotNode !== undefined) {
    await evaluateNode(unprocessedHotNode);
    evaluateHotNodes();
  }
}

export function invalidateNodeCache(targetNode: GraphNode, sync = true) {
  const downstreamNodes = resolveDownstream(targetNode);
  downstreamNodes.forEach(node => {
    invalidateSingleNodeCache(node, sync);
  });
}

export function invalidateSingleNodeCache(targetNode: GraphNode, sync = true) {
  debug(`invalidating "${targetNode.id}"`);
  targetNode.state = {};
  if (sync) {
    sendNodeSync({ serialisedNode: serialiseNode(targetNode) });
  }
}

export function invalidateViewCache(targetNode: GraphNode, sync = true) {
  debug(`invalidating view for "${targetNode.id}"`);
  targetNode.state.viewData = null;
  if (sync) {
    sendNodeSync({ serialisedNode: serialiseNode(targetNode) });
  }
}

async function parseDefinitions(definitionsPath: string) {
  debug(`parsing Cocoon definitions file at "${definitionsPath}"`);
  const nextDefinitions: CocoonDefinitions = parseCocoonDefinitions(
    await readFile(definitionsPath)
  ) || { nodes: {} };
  const previousDefinitions = global.definitions;

  // Apply new definitions
  global.definitionsPath = definitionsPath;
  global.definitions = nextDefinitions;

  // If we already have definitions (and the path didn't change) we can attempt
  // to keep some of the cache alive
  const keepCache =
    previousDefinitions !== undefined &&
    global.definitionsPath === definitionsPath;

  // Create graph
  const nextGraph = createGraphFromDefinitions(global.definitions);
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

  // Sync graph
  sendGraphSync({
    definitionsPath,
    serialisedGraph: serialiseGraph(nextGraph),
  });

  // Re-evaluate hot nodes
  evaluateHotNodes();
}

function createNodeContext(node: GraphNode): NodeContext {
  return {
    cloneFromPort: cloneFromPort.bind(null, node),
    debug: Debug(`core:${node.id}`),
    definitions: global.definitions,
    definitionsPath: global.definitionsPath,
    node,
    progress: (summary, percent) => {
      sendNodeProgress(node.id, { summary, percent });
    },
    readFromPort: readFromPort.bind(null, node),
    writeToPort: writeToPort.bind(null, node),
  };
}

function unwatchDefinitionsFile() {
  const { definitionsPath } = global;
  if (definitionsPath) {
    debug(`removing watch for "${definitionsPath}"`);
    fs.unwatchFile(global.definitionsPath);
  }
}

function watchDefinitionsFile() {
  const { definitionsPath } = global;
  debug(`watching "${definitionsPath}"`);
  fs.watchFile(definitionsPath, { interval: 500 }, () => {
    debug(`definitions file at "${definitionsPath}" was modified`);
    parseDefinitions(definitionsPath);
  });
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

onOpenDefinitions(async args => {
  debug(`opening definitions file`);
  // Delete global state to force a complete graph re-construction
  delete global.definitionsPath;
  delete global.definitions;
  delete global.graph;
  unwatchDefinitionsFile();
  await parseDefinitions(args.definitionsPath);
  watchDefinitionsFile();
});

onUpdateDefinitions(() => {
  updateDefinitions();
});

onEvaluateNode(args => {
  evaluateNodeById(args.nodeId);
});

onPortDataRequest(async args => {
  const { nodeId, port } = args;
  const node = requireNode(nodeId, global.graph);
  debug(`got port data request from "${node.id}"`);
  if (!nodeIsCached(node)) {
    await evaluateNode(node);
  }
  return { data: getPortData(node, port) };
});

// Sync attribute changes in nodes (i.e. the UI changed a node's state)
onNodeSync(args => {
  const { graph } = global;
  const node = requireNode(_.get(args.serialisedNode, 'id'), graph);
  debug(`syncing node "${node.id}"`);
  updateNode(node, args.serialisedNode);
});

// If the node view state changes (due to interacting with the data view window
// of a node), re-evaluate the node
onNodeViewStateChanged(args => {
  const { nodeId } = args;
  const node = requireNode(nodeId, global.graph);
  if (!_.isEqual(args.state, node.viewState)) {
    updateViewState(node, args.state);
    debug(`view state changed for "${node.id}"`);
    evaluateNode(node);

    // Write changes back to definitions
    assignViewState(node.definition, node.viewState);
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
  debug(`creating new node of type "${args.type}"`);
  const nodeId = createUniqueNodeId(graph, args.type);
  const nodeDefinition = createNodeDefinition(
    definitions,
    args.type,
    nodeId,
    args.gridPosition ? args.gridPosition.col : undefined,
    args.gridPosition ? args.gridPosition.row : undefined
  );
  if (args.edge !== undefined) {
    if (args.edge.fromNodeId === undefined) {
      // Create outgoing edge
      assignPortDefinition(
        requireNode(args.edge.toNodeId!, graph).definition,
        args.edge.toNodePort,
        nodeId,
        args.edge.fromNodePort
      );
    } else {
      // Create incoming edge
      assignPortDefinition(
        nodeDefinition,
        args.edge.toNodePort,
        args.edge.fromNodeId,
        args.edge.fromNodePort
      );
    }
  }
  await updateDefinitions();
  parseDefinitions(definitionsPath);
});

onRemoveNode(async args => {
  const { definitions, definitionsPath, graph } = global;
  const { nodeId } = args;
  const node = requireNode(nodeId, graph);
  if (node.edgesOut.length === 0) {
    debug(`removing node "${nodeId}"`);
    removeNodeDefinition(definitions, nodeId);
    await updateDefinitions();
    parseDefinitions(definitionsPath);
  } else {
    debug(`can't remove node "${nodeId}" because it has outgoing edges`);
  }
});

onCreateEdge(async args => {
  const { definitionsPath, graph } = global;
  const { fromNodeId, fromNodePort, toNodeId, toNodePort } = args;
  debug(
    `creating new edge "${fromNodeId}/${fromNodePort} -> ${toNodeId}/${toNodePort}"`
  );
  const toNode = requireNode(toNodeId, graph);
  assignPortDefinition(toNode.definition, toNodePort, fromNodeId, fromNodePort);
  await updateDefinitions();
  parseDefinitions(definitionsPath);
});

onRemoveEdge(async args => {
  const { definitionsPath, graph } = global;
  const { nodeId, port } = args;
  if (port.incoming) {
    debug(`removing edge to "${nodeId}/${port}"`);
    const node = requireNode(nodeId, graph);
    removePortDefinition(node.definition, port.name);
  } else {
    // TODO: remove all connected edges
  }
  await updateDefinitions();
  parseDefinitions(definitionsPath);
});

onCreateView(async args => {
  const { definitionsPath, graph } = global;
  debug(`creating new view of type "${args.type}"`);
  const node = requireNode(args.nodeId, graph);
  invalidateViewCache(node);
  assignViewDefinition(node.definition, args.type, args.port);
  await updateDefinitions();
  parseDefinitions(definitionsPath);
});

onRemoveView(async args => {
  const { definitionsPath, graph } = global;
  debug(`removing view for "${args.nodeId}"`);
  const node = requireNode(args.nodeId, graph);
  invalidateViewCache(node);
  removeViewDefinition(node.definition);
  await updateDefinitions();
  parseDefinitions(definitionsPath);
});

// Send memory usage reports
onMemoryUsageRequest(() => ({
  memoryUsage: process.memoryUsage(),
  process: 'core',
}));

// Emit ready signal
if (process.send) {
  process.send('ready');
}
