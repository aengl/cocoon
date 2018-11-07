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
  createGraphFromDefinitions,
  createUniqueNodeId,
  findPath,
  requireNode,
  resolveDownstream,
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
import { CocoonNode, NodeStatus } from '../common/node';
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
  const targetNode = requireNode(graph, nodeId);
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
    node.status = NodeStatus.unprocessed;
    const context = createNodeContext(node);

    // Process node
    if (nodeObj.process) {
      node.status = NodeStatus.processing;
      sendNodeSync({ serialisedNode: serialiseNode(node) });
      context.debug(`processing`);
      const result = await nodeObj.process(context);
      if (_.isString(result)) {
        node.summary = result;
      } else if (!_.isNil(result)) {
        node.viewData = result;
      }
      node.status =
        node.cache === null ? NodeStatus.unprocessed : NodeStatus.cached;
      sendNodeSync({ serialisedNode: serialiseNode(node) });
    }

    // Create rendering data
    if (nodeObj.serialiseViewData) {
      context.debug(`serialising rendering data`);
      node.viewData = nodeObj.serialiseViewData(context, node.viewState);
      sendNodeSync({ serialisedNode: serialiseNode(node) });
    }
  } catch (error) {
    debug(`error in node "${node.id}"`);
    debug(error);
    node.status = NodeStatus.error;
    node.error = error;
    sendNodeSync({ serialisedNode: serialiseNode(node) });
  }
}

export function evaluateHotNodes() {
  // TODO: If there's a hot node that's downstream of another hot node we'll
  // probably run into trouble. We should have a graph function to calculate a
  // path through multiple nodes and execute it.
  // for (const node of downstreamNodes.filter(n => n.hot)) {
  //   if (node.id !== targetNode.id) {
  //     await evaluateNode(node);
  //   }
  // }
  // TODO: Add new status "processed"; find SOME hot node that's unprocessed and
  // recurse
}

export function invalidateNodeCache(targetNode: CocoonNode) {
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
    sendNodeSync({ serialisedNode: serialiseNode(node) });
  });
}

async function parseDefinitions(definitionsPath: string) {
  debug(`parsing Cocoon definitions file at "${definitionsPath}"`);
  const definitions = parseCocoonDefinitions(await readFile(definitionsPath));
  let createNewGraph = false;

  // If we already have definitions (and the path didn't change), see if we can
  // update the graph without re-building it from scratch (so that we can keep
  // the existing cache as much as possible)
  if (global.definitions && global.definitionsPath === definitionsPath) {
    const diff = diffDefinitions(global.definitions, definitions);
    debug(diff);
    diff.changedNodes.forEach(nodeId => {
      invalidateNodeCache(requireNode(global.graph, nodeId));
    });
    evaluateHotNodes();
  } else {
    createNewGraph = true;
  }

  // Load definitions and create graph
  if (createNewGraph) {
    global.definitionsPath = definitionsPath;
    global.definitions = definitions;
    global.graph = createGraphFromDefinitions(global.definitions);
    sendGraphSync({
      definitionsPath: global.definitionsPath,
      serialisedGraph: serialiseGraph(global.graph),
    });
  }
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
  const node = requireNode(global.graph, nodeId);
  debug(`got port data request from "${node.id}"`);
  if (!node.cache) {
    await evaluateNode(node);
  }
  if (node.cache) {
    sendPortDataResponse({
      data: node.cache.ports[port],
      request: args,
    });
  }
});

// Sync attribute changes in nodes (i.e. the UI changed a node's state)
onNodeSync(args => {
  const { graph } = global;
  const node = requireNode(graph, _.get(args.serialisedNode, 'id'));
  debug(`syncing node "${node.id}"`);
  updatedNode(node, args.serialisedNode);
});

// If the node view state changes (due to interacting with the data view window
// of a node), re-evaluate the node
onNodeViewStateChanged(args => {
  const { nodeId, state } = args;
  const node = requireNode(global.graph, nodeId);
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
  const node = requireNode(global.graph, nodeId);
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
  const connectedNode = requireNode(global.graph, args.connectedNodeId);
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
  const node = requireNode(graph, nodeId);
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
