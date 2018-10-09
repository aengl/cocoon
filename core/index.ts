import { loadDefinitionFromFile } from './definitions';
import { CocoonNode, createGraph, findPath, NodeStatus } from './graph';
import * as nodes from './nodes';

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

  // Instantiate the node
  const nodeClass = nodes[node.type];
  if (!nodeClass) {
    throw new Error(`node type does not exist: ${nodeClass}`);
  }
  const nodeInstance = new nodeClass() as nodes.ICocoonNode<any>;
  const config = node.definition.config;

  // Process the node
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
