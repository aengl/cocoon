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
import { getNode } from './nodes';

const debug = require('debug')('cocoon:index');

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
  debug(path.map(n => n.definition.id).join(' -> '));
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
  debug(`evaluating node with id "${node.definition.id}"`);
  const nodeObj = getNode(node.type);
  const config = node.definition.config || {};
  try {
    node.error = null;
    node.summary = null;
    node.status = NodeStatus.unprocessed;

    // Process node
    if (nodeObj.process) {
      node.status = NodeStatus.processing;
      coreSendNodeStatusUpdate(ui, node.definition.id, node.status);
      const result = await nodeObj.process(config, {
        definitions: global.definitions,
        definitionsPath: global.definitionsPath,
        node,
      });
      if (result) {
        node.summary = result;
      }
      node.status = NodeStatus.cached;
      coreSendNodeStatusUpdate(ui, node.definition.id, node.status);
    }

    // Create rendering data
    if (nodeObj.serialiseRenderingData) {
      node.renderingData = nodeObj.serialiseRenderingData(node);
    }

    coreSendNodeEvaluated(ui, node.definition.id);
  } catch (error) {
    debug(`error in node "${node.definition.id}"`);
    debug(error);
    node.status = NodeStatus.error;
    node.error = error;
    node.summary = error.message;
    coreSendNodeError(ui, node.definition.id, error, error.message);
    coreSendNodeStatusUpdate(ui, node.definition.id, node.status);
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
