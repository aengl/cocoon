import fs from 'fs';
import _ from 'lodash';
import serializeError from 'serialize-error';
import Debug from '../common/debug';
import {
  diffDefinitions,
  parseCocoonDefinitions,
  updateNodesInDefinitions,
} from '../common/definitions';
import {
  CocoonNode,
  createGraphFromDefinitions,
  createUniqueNodeId,
  findPath,
  NodeStatus,
  requireNode,
  resolveDownstream,
  transferGraphState,
} from '../common/graph';
import {
  onCreateNode,
  onEvaluateNode,
  onNodeSync,
  onNodeViewQuery,
  onNodeViewStateChanged,
  onOpenDefinitions,
  onPortDataRequest,
  onRemoveNode,
  onUpdateDefinitions,
  sendError,
  sendGraphSync,
  sendMemoryUsage,
  sendNodeProgress,
  sendNodeSync,
  sendNodeViewQueryResponse,
  sendPortDataResponse,
  serialiseGraph,
  serialiseNode,
  updatedNode,
} from '../common/ipc';
import { readFile, writeYamlFile } from './fs';
import {
  getNode,
  NodeContext,
  readFromPort,
  readPersistedCache,
  writePersistedCache,
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

export async function evaluateNode(targetNode: CocoonNode) {
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
  debug(`processing ${path.length} node(s)`);
  for (const node of path) {
    await evaluateSingleNode(node);
  }

  // Re-evaluate affected hot nodes
  evaluateHotNodes();
}

async function evaluateSingleNode(node: CocoonNode) {
  debug(`evaluating node "${node.id}"`);
  const nodeObj = getNode(node.type);
  try {
    delete node.error;
    delete node.summary;
    delete node.viewData;

    // Update status
    node.status = NodeStatus.processing;
    sendNodeSync({ serialisedNode: serialiseNode(node) });

    // Create node context
    const context = createNodeContext(node);

    // Process node
    if (nodeObj.process) {
      context.debug(`processing`);
      const result = await nodeObj.process(context);
      if (_.isString(result)) {
        node.summary = result;
      } else if (!_.isNil(result)) {
        node.viewData = result;
      }
    }

    // Create rendering data
    if (nodeObj.serialiseViewData) {
      context.debug(`serialising rendering data`);
      node.viewData = nodeObj.serialiseViewData(context, node.viewState);
    }

    // Update status and sync node
    node.status =
      node.cache === null ? NodeStatus.processed : NodeStatus.cached;
    sendNodeSync({ serialisedNode: serialiseNode(node) });
  } catch (error) {
    debug(`error in node "${node.id}"`);
    debug(error);
    node.status = NodeStatus.error;
    node.error = error;
    sendNodeSync({ serialisedNode: serialiseNode(node) });
  }
}

export async function evaluateHotNodes() {
  const { graph } = global;
  const unprocessedHotNode = graph.nodes.find(
    node => node.hot === true && node.status === NodeStatus.unprocessed
  );
  if (unprocessedHotNode !== undefined) {
    await evaluateNode(unprocessedHotNode);
    evaluateHotNodes();
  }
}

export function invalidateNodeCache(targetNode: CocoonNode, sync = true) {
  const downstreamNodes = resolveDownstream(targetNode);
  downstreamNodes.forEach(node => {
    // Set node attributes to "null" instead of deleting them, otherwise we will
    // keep the editor state when synchronising (only defined attributes will
    // overwrite)
    node.cache = null;
    node.error = null;
    node.summary = null;
    node.viewData = null;
    node.status = NodeStatus.unprocessed;
    if (sync) {
      sendNodeSync({ serialisedNode: serialiseNode(node) });
    }
  });
}

async function parseDefinitions(definitionsPath: string) {
  debug(`parsing Cocoon definitions file at "${definitionsPath}"`);
  const nextDefinitions = parseCocoonDefinitions(
    await readFile(definitionsPath)
  );
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

function createNodeContext(node: CocoonNode): NodeContext {
  return {
    config: node.config || {},
    debug: Debug(`core:${node.id}`),
    definitions: global.definitions,
    definitionsPath: global.definitionsPath,
    node,
    progress: (summary, percent) => {
      sendNodeProgress(node.id, { summary, percent });
    },
    readFromPort: readFromPort.bind(null, node),
    readPersistedCache: readPersistedCache.bind(null, node),
    writePersistedCache: writePersistedCache.bind(null, node),
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

// Respond to IPC requests to open a definition file
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

// Respond to IPC requests to update the definition file
onUpdateDefinitions(() => {
  updateDefinitions();
});

// Respond to IPC requests to evaluate a node
onEvaluateNode(args => {
  evaluateNodeById(args.nodeId);
});

// Respond to IPC requests for port data
onPortDataRequest(async args => {
  const { nodeId, port } = args;
  const node = requireNode(nodeId, global.graph);
  debug(`got port data request from "${node.id}"`);
  if (_.isNil(node.cache)) {
    await evaluateNode(node);
  }
  if (!_.isNil(node.cache)) {
    sendPortDataResponse({
      data: node.cache.ports[port],
      request: args,
    });
  }
});

// Sync attribute changes in nodes (i.e. the UI changed a node's state)
onNodeSync(args => {
  const { graph } = global;
  const node = requireNode(_.get(args.serialisedNode, 'id'), graph);
  debug(`syncing node "${node.id}"`);
  updatedNode(node, args.serialisedNode);
});

// If the node view state changes (due to interacting with the data view window
// of a node), re-evaluate the node
onNodeViewStateChanged(args => {
  const { nodeId, state } = args;
  const node = requireNode(nodeId, global.graph);
  debug(`view state changed for "${node.id}"`);
  if (!_.isEqual(args.state, node.viewState)) {
    node.viewState = node.viewState
      ? _.assign({}, node.viewState || {}, state)
      : state;
    evaluateNode(node);
  }
});

// If the node view issues a query, process it and send the response back
onNodeViewQuery(args => {
  const { nodeId, query } = args;
  const node = requireNode(nodeId, global.graph);
  debug(`got view query from "${node.id}"`);
  const nodeObj = getNode(node.type);
  if (nodeObj.respondToQuery) {
    const context = createNodeContext(node);
    const data = nodeObj.respondToQuery(context, query);
    sendNodeViewQueryResponse(nodeId, { data });
  }
});

// The UI wants us to create a new node
onCreateNode(async args => {
  const { definitions, definitionsPath, graph } = global;
  const connectedNode = requireNode(args.connectedNodeId, global.graph);
  debug(`creating new node of type "${args.type}"`);
  // TODO: probably move to definition.ts
  definitions[connectedNode.group].nodes.push({
    [args.type]: {
      col: args.gridPosition ? args.gridPosition.col : undefined,
      id: createUniqueNodeId(graph, args.type),
      in: {
        [args.connectedPort]: `${args.connectedNodeId}/${
          args.connectedNodePort
        }`,
      },
      row: args.gridPosition ? args.gridPosition.row : undefined,
    },
  });
  await updateDefinitions();
  parseDefinitions(definitionsPath);
});

// The UI wants us to remove a node
onRemoveNode(async args => {
  const { definitions, definitionsPath, graph } = global;
  const { nodeId } = args;
  const node = requireNode(nodeId, graph);
  if (node.edgesOut.length === 0) {
    debug(`removing node "${nodeId}"`);
    // TODO: probably move to definition.ts
    const nodes = definitions[node.group].nodes;
    definitions[node.group].nodes = nodes.filter(
      n => n[Object.keys(n)[0]].id !== nodeId
    );
    await updateDefinitions();
    parseDefinitions(definitionsPath);
  } else {
    debug(`can't remove node "${nodeId}" because it has outgoing edges`);
  }
});

// Send memory usage reports
setInterval(() => {
  sendMemoryUsage({ memoryUsage: process.memoryUsage() });
}, 1000);

// Emit ready signal
if (process.send) {
  process.send('ready');
}
