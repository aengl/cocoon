import Debug from 'debug';
import fs from 'fs';
import {
  coreOnOpenDefinitions,
  coreSendError,
  coreSendGraphChanged,
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
  coreSendError({ error, message: error.message });
});

coreOnOpenDefinitions(args => {
  open(args.definitionsPath);
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

export async function run(
  nodeId: string,
  evaluatedCallback?: (node: CocoonNode) => void
) {
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
      node.cache = null;
      node.status = NodeStatus.unprocessed;
      // coreSendNodeStatusUpdate(ui, node.id, node.status);
    }
  });

  // Process nodes
  debug(`processing ${path.length} node(s)`);
  for (const node of path) {
    await evaluateNode(node);
    if (evaluatedCallback) {
      evaluatedCallback(node);
    }
  }
  debug(`finished`);
}

export async function evaluateNode(node: CocoonNode) {
  debug(`evaluating node with id "${node.id}"`);
  const nodeObj = getNode(node.type);
  const config = node.config || {};
  try {
    node.error = null;
    node.summary = null;
    node.status = NodeStatus.unprocessed;

    const context: NodeContext = {
      config,
      debug: Debug(`cocoon:${node.id}`),
      definitions: global.definitions,
      definitionsPath: global.definitionsPath,
      node,
    };

    // Process node
    if (nodeObj.process) {
      node.status = NodeStatus.processing;
      // coreSendNodeStatusUpdate(ui, node.id, node.status);
      context.debug(`processing`);
      const result = await nodeObj.process(context);
      if (result) {
        node.summary = result;
      }
      node.status =
        node.cache === null ? NodeStatus.unprocessed : NodeStatus.cached;
      // coreSendNodeStatusUpdate(ui, node.id, node.status);
    }

    // Create rendering data
    if (nodeObj.serialiseRenderingData) {
      context.debug(`serialising rendering data`);
      node.renderingData = nodeObj.serialiseRenderingData(context);
    }

    // coreSendNodeEvaluated(ui, node.id);
  } catch (error) {
    debug(`error in node "${node.id}"`);
    debug(error);
    node.status = NodeStatus.error;
    node.error = error;
    node.summary = error.message;
    // coreSendNodeError(ui, node.id, error, error.message);
    // coreSendNodeStatusUpdate(ui, node.id, node.status);
  }
}

async function parseDefinitions(definitionsPath: string) {
  debug(`parsing Cocoon definitions file at "${definitionsPath}"`);
  const definitions = await readFile(definitionsPath);

  // Load definitions and create graph
  global.definitionsPath = definitionsPath;
  global.definitions = parseCocoonDefinitions(definitions);
  global.graph = createGraph(global.definitions);
  coreSendGraphChanged({
    definitions,
    definitionsPath,
  });
}
