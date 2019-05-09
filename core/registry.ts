import _ from 'lodash';
import { PackageJson } from 'type-fest';
import { CocoonDefinitionsInfo } from '../common/definitions';
import { CocoonNode, objectIsNode } from '../common/node';
import {
  CocoonRegistry,
  createEmptyRegistry,
  registerCocoonNode,
  registerCocoonView,
} from '../common/registry';
import { objectIsView } from '../common/view';
import {
  checkPath,
  findPath,
  parseJsonFile,
  resolveDirectoryContents,
  resolvePath,
} from './fs';
import { defaultNodes } from './nodes';
import path from 'path';

const debug = require('debug')('core:registry');

export async function createAndInitialiseRegistry(
  definitions: CocoonDefinitionsInfo
) {
  debug(`creating node registry`);
  const registry = createEmptyRegistry();

  // Register built-in nodes
  _.sortBy(
    Object.keys(defaultNodes)
      .filter(key => objectIsNode(defaultNodes[key]))
      .map(type => ({
        node: defaultNodes[type] as CocoonNode,
        type,
      })),
    'type'
  ).forEach(x => registerCocoonNode(registry, x.type, x.node));

  // Import custom nodes from fs
  const fsOptions = { root: definitions.root };
  const nodeModulesPath = checkPath('node_modules/@cocoon', fsOptions);
  const nodeModulesDirectories = nodeModulesPath
    ? await resolveDirectoryContents(nodeModulesPath)
    : [];
  await Promise.all(
    _.concat(['nodes', '.cocoon/nodes'], nodeModulesDirectories)
      .map(x => checkPath(x, fsOptions))
      .filter(x => Boolean(x))
      .map(x => importNodesAndViews(x!, registry))
  );

  return registry;
}

async function importNodesAndViews(
  importPath: string,
  registry: CocoonRegistry
) {
  debug(`importing nodes and views from ${importPath}`);

  try {
    // Try and import nodes from a project
    const isProjectFolder = await importFromPackageJson(importPath, registry);

    // Fall back to scanning for JS files and import them
    if (!isProjectFolder) {
      const files = await resolveDirectoryContents(importPath, {
        predicate: fileName => fileName.endsWith('.js'),
      });
      await Promise.all(
        files.map(async filePath => importFromModule(registry, filePath))
      );
    }
  } catch (error) {
    error.message = `error importing "${importPath}": ${error.message}`;
    throw error;
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
    if (packageJson.main) {
      const mainModule = findPath(packageJson.main, {
        root: projectRoot,
      });
      const ecmaModule = packageJson.module
        ? findPath(packageJson.module, {
            root: projectRoot,
          })
        : undefined;
      await importFromModule(registry, mainModule, ecmaModule);
    }
    return true;
  }
  return false;
}

export async function importFromModule(
  registry: CocoonRegistry,
  mainModulePath: string,
  ecmaModulePath?: string
) {
  delete require.cache[mainModulePath];
  const moduleExports = await import(mainModulePath);
  Object.keys(moduleExports).forEach(key => {
    const obj = moduleExports[key];
    if (objectIsNode(obj)) {
      debug(`imported node "${key}" from "${mainModulePath}"`);
      registerCocoonNode(registry, key, obj);
    } else if (objectIsView(obj)) {
      debug(`imported view "${key}" from "${mainModulePath}"`);
      if (!ecmaModulePath) {
        throw new Error(
          `package for view "${key}" does not export a "module" for view components`
        );
      }
      obj.component = ecmaModulePath;
      registerCocoonView(registry, key, obj);
    }
  });
}
