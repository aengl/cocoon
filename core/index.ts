import { loadDefinitionFromFile } from './definitions';
import { CocoonNode, createGraph, findPath, NodeStatus } from './graph';
import { ipcSend } from './ipc';
import { createNodeInstance } from './nodes/create';

const debug = require('debug')('cocoon:index');

export function open(definitionsPath: string) {
  global.definitionsPath = definitionsPath;
  global.definitions = loadDefinitionFromFile(definitionsPath);
  global.graph = createGraph(global.definitions);
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
  const nodeInstance = createNodeInstance(node.type);
  const config = node.definition.config;
  try {
    if (nodeInstance.process) {
      node.status = NodeStatus.processing;
      ipcSend(ui, 'node-status-update', node.definition.id, node.status);
      await nodeInstance.process(config, {
        definitions: global.definitions,
        definitionsPath: global.definitionsPath,
        node,
      });
      node.status = NodeStatus.cached;
      ipcSend(ui, 'node-status-update', node.definition.id, node.status);
    }
    ipcSend(ui, 'node-evaluated', node.definition.id);
  } catch (error) {
    debug(error);
    node.status = NodeStatus.error;
    node.error = error;
  }
}
