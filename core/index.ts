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

  // Load definitions and create graph
  global.definitionsPath = definitionsPath;
  global.definitions = loadDefinitionFromFile(definitionsPath);
  global.graph = createGraph(global.definitions);

  // Watch file for changes
  fs.watchFile(definitionsPath, () => {
    debug(`definitions file at "${definitionsPath}" was modified`);
    global.definitions = loadDefinitionFromFile(definitionsPath);
    global.graph = createGraph(global.definitions);
    ipcSend(ui, 'definitions-changed');
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
  graphNode: CocoonNode,
  ui?: Electron.WebContents
) {
  debug(`evaluating node with id "${graphNode.definition.id}"`);
  const node = getNode(graphNode.type);
  const config = graphNode.definition.config;
  try {
    graphNode.status = NodeStatus.unprocessed;

    // Process node
    if (node.process) {
      graphNode.status = NodeStatus.processing;
      ipcSend(
        ui,
        'node-status-update',
        graphNode.definition.id,
        graphNode.status
      );
      await node.process(config, {
        definitions: global.definitions,
        definitionsPath: global.definitionsPath,
        node: graphNode,
      });
      graphNode.status = NodeStatus.cached;
      ipcSend(
        ui,
        'node-status-update',
        graphNode.definition.id,
        graphNode.status
      );
    }

    // Create rendering data
    if (node.serialiseRenderingData) {
      graphNode.renderingData = node.serialiseRenderingData(graphNode);
    }

    ipcSend(ui, 'node-evaluated', graphNode.definition.id);
  } catch (error) {
    debug(`error in node "${graphNode.definition.id}"`);
    debug(error);
    graphNode.status = NodeStatus.error;
    graphNode.error = error;
    ipcSend(
      ui,
      'node-status-update',
      graphNode.definition.id,
      graphNode.status
    );
  }
}
