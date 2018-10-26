import Debug from 'debug';
import fs from 'fs';
import _ from 'lodash';
import serializeError from 'serialize-error';
import {
  onEvaluateNode,
  onNodeViewStateChanged,
  onOpenDefinitions,
  sendCoreMemoryUsage,
  sendError,
  sendGraphChanged,
  sendNodeError,
  sendNodeEvaluated,
  sendNodeProgress,
  sendNodeStatusUpdate,
} from '../ipc';
import { parseCocoonDefinitions } from './definitions';
import { readFile } from './fs';
import {
  CocoonNode,
  createGraph,
  findNode,
  findPath,
  NodeStatus,
  resolveDownstream,
  shortenPathUsingCache,
} from './graph';
import { getNode, NodeContext } from './nodes';

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

export async function run(nodeId: string) {
  const { graph } = global;

  // Figure out the evaluation path
  debug(`running graph to generate results for node "${nodeId}"`);
  const targetNode = findNode(graph, nodeId);
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
  resolveDownstream(targetNode).forEach(node => {
    if (node.id !== nodeId) {
      delete node.cache;
      node.status = NodeStatus.unprocessed;
      sendNodeStatusUpdate(node.id, { status: node.status });
    }
  });

  // Process nodes
  debug(`processing ${path.length} node(s)`);
  for (const node of path) {
    await evaluateNode(node);
  }
  debug(`finished`);
}

export async function evaluateNode(node: CocoonNode) {
  debug(`evaluating node with id "${node.id}"`);
  const nodeObj = getNode(node.type);
  const config = node.config || {};
  try {
    delete node.error;
    delete node.summary;
    node.status = NodeStatus.unprocessed;

    const context: NodeContext = {
      config,
      debug: Debug(`cocoon:${node.id}`),
      definitions: global.definitions,
      definitionsPath: global.definitionsPath,
      node,
      progress: (summary, percent) => {
        sendNodeProgress(node.id, { summary, percent });
      },
    };

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

// Respond to IPC requests to open a definition file
onOpenDefinitions(args => {
  open(args.definitionsPath);
});

// Respond to IPC requests to evaluate a node
onEvaluateNode(args => {
  run(args.nodeId);
});

// If the node view state changes (due to interacting with the data view window
// of a node), re-evaluate the node
onNodeViewStateChanged(args => {
  const { nodeId, state } = args;
  const node = findNode(global.graph, nodeId);
  node.viewState = node.viewState
    ? _.assign({}, node.viewState || {}, state)
    : state;
  evaluateNode(node);
});

// Send memory usage reports
setInterval(() => {
  sendCoreMemoryUsage({ memoryUsage: process.memoryUsage() });
}, 1000);
