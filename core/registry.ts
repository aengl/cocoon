import _ from 'lodash';
import { PackageJson } from 'type-fest';
import { CocoonDefinitionsInfo } from '../common/definitions';
import { GraphNode } from '../common/graph';
import { CocoonNode, CocoonRegistry, objectIsNode } from '../common/node';
import {
  checkPath,
  findPath,
  parseJsonFile,
  resolveDirectoryContents,
  resolvePath,
} from './fs';
import { defaultNodes } from './nodes';
import { objectIsView } from '../common/view';

const debug = require('debug')('core:registry');

export async function createNodeRegistry(definitions: CocoonDefinitionsInfo) {
  debug(`creating node registry`);
  const defaultRegistry = _.sortBy(
    Object.keys(defaultNodes)
      .filter(key => objectIsNode(defaultNodes[key]))
      .map(type => ({
        node: defaultNodes[type] as CocoonNode,
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
      .map(x => importNodesAndViews(x!))
  );
  return registries.reduce(
    (registry, patch) => _.assign(registry, patch),
    defaultRegistry
  );
}

async function importNodesAndViews(importPath: string) {
  debug(`importing nodes and views from ${importPath}`);
  const registry: CocoonRegistry = {};

  // Try and import nodes from a project
  const isProjectFolder = await importFromPackageJson(importPath, registry);

  // Fall back to scanning for JS files and import them
  if (!isProjectFolder) {
    const files = await resolveDirectoryContents(importPath, {
      predicate: fileName => fileName.endsWith('.js'),
    });
    await Promise.all(
      files.map(async filePath => importFromModule(filePath, registry))
    );
  }

  return registry;
}

async function importFromPackageJson(
  projectRoot: string,
  registry: CocoonRegistry
) {
  const packageJsonPath = checkPath(
    resolvePath('package.json', {
      root: projectRoot,
    })
  );
  if (packageJsonPath) {
    debug(`parsing package.json at "${packageJsonPath}"`);
    const packageJson = (await parseJsonFile(packageJsonPath)) as PackageJson;
    const cocoon = packageJson.cocoon as any;
    if (cocoon) {
      if (cocoon.views) {
        const viewsModule = findPath(cocoon.views, {
          root: projectRoot,
        });
        await importFromModule(viewsModule, registry);
      }
      if (cocoon.nodes) {
        const nodesModule = findPath(cocoon.nodes, {
          root: projectRoot,
        });
        await importFromModule(nodesModule, registry);
      }
    } else if (packageJson.main) {
      const mainModule = findPath(packageJson.main, {
        root: projectRoot,
      });
      await importFromModule(mainModule, registry);
    }
    return true;
  }
  return false;
}

export async function importFromModule(
  modulePath: string,
  registry: CocoonRegistry
) {
  delete require.cache[modulePath];
  const moduleExports = await import(modulePath);
  Object.keys(moduleExports).forEach(key => {
    const obj = moduleExports[key];
    if (objectIsNode(obj)) {
      debug(`imported node "${key}" from "${modulePath}"`);
      registry[key] = obj;
    } else if (objectIsView(obj)) {
      debug(`imported view "${key}" from "${modulePath}"`);
      // registry[key] = obj;
    }
  });
}

export function getCocoonNodeFromType(
  registry: CocoonRegistry,
  type: string
): CocoonNode {
  const node = registry[type];
  if (!node) {
    throw new Error(`node type does not exist: ${type}`);
  }
  return node;
}

export function getCocoonNodeFromGraphNode(
  registry: CocoonRegistry,
  node: GraphNode
): CocoonNode {
  return getCocoonNodeFromType(registry, node.definition.type);
}
