import { loadDefinitionFromFile } from './definitions';
import { CocoonNode, createGraph, findPath, NodeStatus } from './graph';
import { createNodeInstance } from './nodes/create';

const debug = require('debug')('cocoon:index');

export function open(definitionsPath: string) {
  global.definitionsPath = definitionsPath;
  global.definitions = loadDefinitionFromFile(definitionsPath);
  global.graph = createGraph(global.definitions);
}

export async function run(nodeId: string) {
  debug(`running graph to generate results for node "${nodeId}"`);
  const path = findPath(global.graph, nodeId);
  debug(path);
  debug(`processing ${path.length} node(s)`);
  for (const node of path) {
    await evaluateNode(node);
  }
  debug(`finished`);
}

export async function evaluateNode(node: CocoonNode) {
  debug(`evaluating node with id "${node.definition.id}"`);
  const nodeInstance = createNodeInstance(node.type);
  const config = node.definition.config;
  try {
    node.status = NodeStatus.processing;
    await nodeInstance.process(config, {
      definitions: global.definitions,
      definitionsPath: global.definitionsPath,
      node,
    });
    node.status = NodeStatus.cached;
  } catch (error) {
    debug(error);
    node.status = NodeStatus.error;
    node.error = error;
  }
}
