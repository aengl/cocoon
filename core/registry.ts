import _ from 'lodash';
import Debug from '../common/debug';
import { CocoonDefinitionsInfo } from '../common/definitions';
import { GraphNode } from '../common/graph';
import { NodeObject, NodeRegistry, objectIsNode } from '../common/node';
import { checkPath, resolveDirectoryContents } from './fs';
import { defaultNodes } from './nodes';

const debug = Debug('core:registry');

export async function createNodeRegistry(definitions: CocoonDefinitionsInfo) {
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
  const fsOptions = { root: definitions.root };
  const nodeModulesPath = checkPath('node_modules/@cocoon', fsOptions);
  const nodeModulesDirectories = nodeModulesPath
    ? await resolveDirectoryContents(nodeModulesPath)
    : [];
  const registries = await Promise.all(
    _.concat(['nodes', '.cocoon/nodes'], nodeModulesDirectories)
      .map(x => checkPath(x, fsOptions))
      .filter(x => Boolean(x))
      .map(x => importNodesInDirectory(x!))
  );
  return registries.reduce(
    (registry, patch) => _.assign(registry, patch),
    defaultRegistry
  );
}

async function importNodesInDirectory(importPath: string) {
  debug(`importing nodes from ${importPath}`);
  const files = await resolveDirectoryContents(importPath, {
    predicate: fileName => fileName.endsWith('.js'),
  });
  const registry: NodeRegistry = {};
  files.forEach(async filePath => {
    delete require.cache[filePath];
    const moduleExports = await import(filePath);
    Object.keys(moduleExports).forEach(key => {
      const obj = moduleExports[key];
      if (objectIsNode(obj)) {
        debug(`imported node "${key}" from "${filePath}"`);
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
