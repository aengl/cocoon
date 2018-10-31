import fs from 'fs';
import _ from 'lodash';
import serializeError from 'serialize-error';
import { parseCocoonDefinitions } from '../common/definitions';
import {
  onEvaluateNode,
  onNodeSync,
  onNodeViewQuery,
  onNodeViewStateChanged,
  onOpenDefinitions,
  onPortDataRequest,
  sendCoreMemoryUsage,
  sendError,
  sendGraphChanged,
  sendNodeError,
  sendNodeEvaluated,
  sendNodeProgress,
  sendNodeStatusUpdate,
  sendNodeViewQueryResponse,
  sendPortDataResponse,
} from '../common/ipc';
import { CocoonNode, NodeStatus } from '../common/node';
import Debug from './debug';
import { readFile } from './fs';
import {
  createGraph,
  findNode,
  findPath,
  resolveDownstream,
  shortenPathUsingCache,
} from './graph';
import {
  getNode,
  NodeContext,
  readFromPort,
  readPersistedCache,
  writePersistedCache,
  writeToPort,
} from './nodes';

const debug = Debug('cocoon:index');

process.on('unhandledRejection', e => {
  throw e;
});

process.on('uncaughtException', error => {
  sendError({ error: serializeError(error) });
});

export function open(definitionsPath: string) {
  // Unwatch previous file
  if (global.definitionsPath) {
    fs.unwatchFile(global.definitionsPath);
  }

  // Asynchronously parse definitions
  parseDefinitions(definitionsPath);

  // Watch file for changes
  debug(`watching definitions file at "${definitionsPath}"`);
  fs.watchFile(definitionsPath, { interval: 500 }, () => {
    debug(`definitions file at "${definitionsPath}" was modified`);
    parseDefinitions(definitionsPath);
  });
}

export async function evaluateNodeById(nodeId: string) {
  const { graph } = global;
  const targetNode = findNode(graph, nodeId);
  return evaluateNode(targetNode);
}

export async function evaluateNode(targetNode: CocoonNode) {
  // Figure out the evaluation path
  debug(`running graph to generate results for node "${targetNode.id}"`);
  const path = shortenPathUsingCache(findPath(targetNode));
  if (path.length === 0) {
    // If all upstream nodes are cached or the node is a starting node, the path
    // will be an empty array. In that case, re-evaluate the target node only.
    path.push(targetNode);
  }
  if (path.length > 1) {
    debug(path.map(n => n.id).join(' -> '));
  }

  // Clear downstream cache
  const downstreamNodes = resolveDownstream(targetNode);
  downstreamNodes.forEach(node => {
    if (node.id !== targetNode.id) {
      delete node.cache;
      node.status = NodeStatus.unprocessed;
      sendNodeStatusUpdate(node.id, { status: node.status });
    }
  });

  // Process nodes
  debug(`processing ${path.length} node(s)`);
  for (const node of path) {
    await evaluateSingleNode(node);
  }

  // Re-evaluate affected hot nodes
  //
  // TODO: If there's a hot node that's downstream of another hot node we'll
  // probably run into trouble. We should have a graph function to calculate a
  // path through multiple nodes and execute it.
  for (const node of downstreamNodes.filter(n => n.hot)) {
    if (node.id !== targetNode.id) {
      await evaluateNode(node);
    }
  }
}

async function evaluateSingleNode(node: CocoonNode) {
  debug(`evaluating node with id "${node.id}"`);
  const nodeObj = getNode(node.type);
  try {
    delete node.error;
    delete node.summary;
    node.status = NodeStatus.unprocessed;
    const context = createNodeContext(node);

    // Process node
    if (nodeObj.process) {
      node.status = NodeStatus.processing;
      sendNodeStatusUpdate(node.id, { status: node.status });
      context.debug(`processing`);
      const result = await nodeObj.process(context);
      if (result) {
        node.summary = result;
      }
      node.status =
        node.cache === null ? NodeStatus.unprocessed : NodeStatus.cached;
      sendNodeStatusUpdate(node.id, { status: node.status });
    }

    // Create rendering data
    if (nodeObj.serialiseViewData) {
      context.debug(`serialising rendering data`);
      node.viewData = nodeObj.serialiseViewData(context, node.viewState);
    }

    sendNodeEvaluated(node.id, {
      summary: node.summary,
      viewData: node.viewData,
    });
  } catch (error) {
    debug(`error in node "${node.id}"`);
    debug(error);
    node.status = NodeStatus.error;
    node.error = error;
    sendNodeError(node.id, {
      error: serializeError(error),
    });
    sendNodeStatusUpdate(node.id, { status: node.status });
  }
}

async function parseDefinitions(definitionsPath: string) {
  debug(`parsing Cocoon definitions file at "${definitionsPath}"`);
  const definitions = await readFile(definitionsPath);

  // Load definitions and create graph
  global.definitionsPath = definitionsPath;
  global.definitions = parseCocoonDefinitions(definitions);
  global.graph = createGraph(global.definitions);
  sendGraphChanged({
    definitions,
    definitionsPath,
  });
}

function createNodeContext(node: CocoonNode): NodeContext {
  return {
    config: node.config || {},
    debug: Debug(`cocoon:${node.id}`),
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

// Respond to IPC requests to open a definition file
onOpenDefinitions(args => {
  open(args.definitionsPath);
});

// Respond to IPC requests to evaluate a node
onEvaluateNode(args => {
  evaluateNodeById(args.nodeId);
});

// Respond to IPC requests for port data
onPortDataRequest(async args => {
  const { nodeId, port } = args;
  const node = findNode(global.graph, nodeId);
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
  const node = findNode(graph, args.nodeId);
  _.assign(node, args);
});

// If the node view state changes (due to interacting with the data view window
// of a node), re-evaluate the node
onNodeViewStateChanged(args => {
  const { nodeId, state } = args;
  const node = findNode(global.graph, nodeId);
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
  const node = findNode(global.graph, nodeId);
  const nodeObj = getNode(node.type);
  if (nodeObj.respondToQuery) {
    const context = createNodeContext(node);
    const data = nodeObj.respondToQuery(context, query);
    sendNodeViewQueryResponse(nodeId, { data });
  }
});

// Send memory usage reports
setInterval(() => {
  sendCoreMemoryUsage({ memoryUsage: process.memoryUsage() });
}, 1000);
