import fs from 'fs';
import { loadDefinitionFromFile } from './definitions';
import { CocoonNode, createGraph, findPath, NodeStatus } from './graph';
import { ipcSend } from './ipc';
import { getNode } from './nodes';

const debug = require('debug')('cocoon:index');

export function open(definitionsPath: string, ui?: Electron.WebContents) {
  // Unwatch previous file
  if (global.definitionsPath) {
    fs.unwatchFile(global.definitionsPath);
  }

  parseDefinitions(definitionsPath, ui);

  // Watch file for changes
  debug(`watching definitions file at "${definitionsPath}"`);
  fs.watchFile(definitionsPath, () => {
    debug(`definitions file at "${definitionsPath}" was modified`);
    if (parseDefinitions(definitionsPath, ui)) {
      ipcSend(ui, 'definitions-changed');
    }
  });
}

export async function run(nodeId: string, ui?: Electron.WebContents) {
  debug(`running graph to generate results for node "${nodeId}"`);
  const path = findPath(global.graph, nodeId);
  debug(path.map(n => n.definition.id).join(' -> '));
  debug(`processing ${path.length} node(s)`);
  for (const node of path) {
    await evaluateNode(node, ui);
  }
  debug(`finished`);
}

export async function evaluateNode(
  node: CocoonNode,
  ui?: Electron.WebContents
) {
  debug(`evaluating node with id "${node.definition.id}"`);
  const nodeObj = getNode(node.type);
  const config = node.definition.config;
  try {
    node.status = NodeStatus.unprocessed;

    // Process node
    if (nodeObj.process) {
      node.status = NodeStatus.processing;
      ipcSend(ui, 'node-status-update', node.definition.id, node.status);
      await nodeObj.process(config, {
        definitions: global.definitions,
        definitionsPath: global.definitionsPath,
        node,
      });
      node.status = NodeStatus.cached;
      ipcSend(ui, 'node-status-update', node.definition.id, node.status);
    }

    // Create rendering data
    if (nodeObj.serialiseRenderingData) {
      node.renderingData = nodeObj.serialiseRenderingData(node);
    }

    ipcSend(ui, 'node-evaluated', node.definition.id);
  } catch (error) {
    debug(`error in node "${node.definition.id}"`);
    debug(error);
    node.status = NodeStatus.error;
    node.error = error;
    ipcSend(ui, 'node-status-update', node.definition.id, node.status);
  }
}

function parseDefinitions(definitionsPath: string, ui?: Electron.WebContents) {
  try {
    // Load definitions and create graph
    global.definitionsPath = definitionsPath;
    global.definitions = loadDefinitionFromFile(definitionsPath);
    global.graph = createGraph(global.definitions);
    return true;
  } catch (error) {
    ipcSend(ui, 'error', error);
    return false;
  }
}
