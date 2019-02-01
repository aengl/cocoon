import _ from 'lodash';
import Debug from '../common/debug';
import { GraphNode } from '../common/graph';
import { NodeObject, NodeRegistry, objectIsNode } from '../common/node';
import { checkFile, resolveDirectory, resolveDirectoryContents } from './fs';
import { defaultNodes } from './nodes';

const debug = Debug('core:registry');

export async function createNodeRegistry(definitionsPath: string) {
  debug(`creating node registry`);
  const defaultRegistry = _.sortBy(
    Object.keys(defaultNodes)
      .filter(key => objectIsNode(defaultNodes[key]))
      .map(type => ({
        node: defaultNodes[type] as NodeObject,
        type,
      })),
    'type'
  ).reduce((all, x) => _.assign(all, { [x.type]: x.node }), {});

  // Import custom nodes from fs
  const definitionsRoot = resolveDirectory(definitionsPath);
  const registries = await Promise.all(
    ['nodes', '.cocoon/nodes']
      .map(x => checkFile(x, definitionsRoot))
      .filter(x => Boolean(x))
      .map(x => importNodesInDirectory(x!))
  );
  return registries.reduce(
    (registry, patch) => _.assign(registry, patch),
    defaultRegistry
  );
}

async function importNodesInDirectory(importPath: string) {
  const files = await resolveDirectoryContents(importPath, fileName =>
    fileName.endsWith('.js')
  );
  const registry: NodeRegistry = {};
  files.forEach(filePath => {
    delete require.cache[filePath];
    const moduleExports = require(filePath);
    Object.keys(moduleExports).forEach(key => {
      const obj = moduleExports[key];
      if (objectIsNode(obj)) {
        debug(`imported custom node "${key}" from "${filePath}"`);
        registry[key] = obj;
      }
    });
  });
  return registry;
}

export function getNodeObjectFromType(
  registry: NodeRegistry,
  type: string
): NodeObject {
  const node = registry[type];
  if (!node) {
    throw new Error(`node type does not exist: ${type}`);
  }
  return node;
}

export function getNodeObjectFromNode(
  registry: NodeRegistry,
  node: GraphNode
): NodeObject {
  return getNodeObjectFromType(registry, node.definition.type);
}
