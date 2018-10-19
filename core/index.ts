import Debug from 'debug';
import fs from 'fs';
import {
  coreSendDefinitionsChanged,
  coreSendDefinitionsError,
  coreSendNodeError,
  coreSendNodeEvaluated,
  coreSendNodeStatusUpdate,
} from '../editor/ipc';
import { loadDefinitionFromFile } from './definitions';
import { CocoonNode, createGraph, findPath, NodeStatus } from './graph';
import { getNode, NodeContext } from './nodes';

const debug = Debug('cocoon:index');

export function open(definitionsPath: string, ui?: Electron.WebContents) {
  // Unwatch previous file
  if (global.definitionsPath) {
    fs.unwatchFile(global.definitionsPath);
  }

  // Asynchronously parse definitions
  parseDefinitions(definitionsPath, ui);

  // Watch file for changes
  debug(`watching definitions file at "${definitionsPath}"`);
  fs.watchFile(definitionsPath, { interval: 500 }, () => {
    debug(`definitions file at "${definitionsPath}" was modified`);
    parseDefinitions(definitionsPath, ui);
  });
}

export async function run(
  nodeId: string,
  ui?: Electron.WebContents,
  evaluatedCallback?: (node: CocoonNode) => void
) {
  debug(`running graph to generate results for node "${nodeId}"`);
  const path = findPath(global.graph, nodeId);
  debug(path.map(n => n.id).join(' -> '));
  debug(`processing ${path.length} node(s)`);
  for (const node of path) {
    await evaluateNode(node, ui);
    if (evaluatedCallback) {
      evaluatedCallback(node);
    }
  }
  debug(`finished`);
}

export async function evaluateNode(
  node: CocoonNode,
  ui?: Electron.WebContents
) {
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
      coreSendNodeStatusUpdate(ui, node.id, node.status);
      context.debug(`processing`);
      const result = await nodeObj.process(context);
      if (result) {
        node.summary = result;
      }
      node.status = NodeStatus.cached;
      coreSendNodeStatusUpdate(ui, node.id, node.status);
    }

    // Create rendering data
    if (nodeObj.serialiseRenderingData) {
      context.debug(`serialising rendering data`);
      node.renderingData = nodeObj.serialiseRenderingData(context);
    }

    coreSendNodeEvaluated(ui, node.id);
  } catch (error) {
    debug(`error in node "${node.id}"`);
    debug(error);
    node.status = NodeStatus.error;
    node.error = error;
    node.summary = error.message;
    coreSendNodeError(ui, node.id, error, error.message);
    coreSendNodeStatusUpdate(ui, node.id, node.status);
  }
}

async function parseDefinitions(
  definitionsPath: string,
  ui?: Electron.WebContents
) {
  try {
    // Load definitions and create graph
    global.definitionsPath = definitionsPath;
    global.definitions = await loadDefinitionFromFile(definitionsPath);
    global.graph = createGraph(global.definitions);
    coreSendDefinitionsChanged(ui, definitionsPath);
  } catch (error) {
    debug(error);
    coreSendDefinitionsError(ui, error);
  }
}
