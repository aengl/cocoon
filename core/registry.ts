import _ from 'lodash';
import { PackageJson } from 'type-fest';
import Debug from '../common/debug';
import { CocoonDefinitionsInfo } from '../common/definitions';
import { GraphNode } from '../common/graph';
import { NodeObject, NodeRegistry, objectIsNode } from '../common/node';
import {
  checkPath,
  parseJsonFile,
  resolveDirectoryContents,
  findPath,
} from './fs';
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
      .map(x => importNodes(x!))
  );
  return registries.reduce(
    (registry, patch) => _.assign(registry, patch),
    defaultRegistry
  );
}

async function importNodes(importPath: string) {
  debug(`importing nodes from ${importPath}`);
  const files = await resolveDirectoryContents(importPath, {
    predicate: fileName => fileName.endsWith('.js'),
  });
  const registry: NodeRegistry = {};
  await Promise.all([
    importNodesFromPackageJson(importPath, registry),
    ...files.map(async filePath => importNodeFromModule(filePath, registry)),
  ]);
  return registry;
}

async function importNodesFromPackageJson(
  projectRoot: string,
  registry: NodeRegistry
) {
  const packageJsonPath = checkPath('package.json', {
    root: projectRoot,
  });
  if (packageJsonPath) {
    debug(`parsing package.json at "${packageJsonPath}"`);
    const packageJson = (await parseJsonFile(packageJsonPath)) as PackageJson;
    if (packageJson.main) {
      debug(`including nodes from main directive`);
      const mainModule = findPath(packageJson.main, {
        root: projectRoot,
      });
      await importNodeFromModule(mainModule, registry);
    }
  }
}

export async function importNodeFromModule(
  modulePath: string,
  registry: NodeRegistry
) {
  delete require.cache[modulePath];
  const moduleExports = await import(modulePath);
  Object.keys(moduleExports).forEach(key => {
    const obj = moduleExports[key];
    if (objectIsNode(obj)) {
      debug(`imported node "${key}" from "${modulePath}"`);
      registry[key] = obj;
    }
  });
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
