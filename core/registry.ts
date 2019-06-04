import _ from 'lodash';
import Module from 'module';
import path from 'path';
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
  readFile,
  resolveDirectoryContents,
  resolvePath,
} from './fs';
import { defaultNodes } from './nodes';

const debug = require('debug')('core:registry');

interface ImportInfo {
  main: string;
  module?: string;
}

interface ImportResult {
  [node: string]: {
    module: string;
    importTimeInMs: number;
    component?: string;
  };
}

export async function createAndInitialiseRegistry(
  definitions: CocoonDefinitionsInfo
) {
  debug(`creating node registry`);
  const registry = createEmptyRegistry();
  const fsOptions = { root: definitions.root };

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

  // Find JS modules in special sub-folders for nodes
  const folderImports = (await Promise.all(
    ['nodes', '.cocoon/nodes']
      .map(x => checkPath(x, fsOptions))
      .filter((x): x is string => Boolean(x))
      .map(x =>
        resolveDirectoryContents(x, {
          predicate: fileName => fileName.endsWith('.js'),
        })
      )
  ))
    .flat()
    .map((x): ImportInfo | null => (x ? { main: x } : null));

  // Collect nodes and views from `node_modules`
  const nodeModulesPaths = checkPath('node_modules/@cocoon', fsOptions);
  const nodeModuleImports = nodeModulesPaths
    ? await Promise.all(
        (await resolveDirectoryContents(nodeModulesPaths)).map(parsePackageJson)
      )
    : [];

  // Collect nodes and views from definition package
  const packageImport = await parsePackageJson(definitions.root);

  // Import all collected nodes and views
  const importResults = (await Promise.all(
    [...folderImports, ...nodeModuleImports, packageImport]
      .filter((x): x is ImportInfo => Boolean(x))
      .map(x => importFromModule(registry, x.main, x.module))
  )).reduce((all, x) => ({ ...all, ...x }), {});

  debug('imported nodes and views', importResults);
  return registry;
}

async function parsePackageJson(
  projectRoot: string
): Promise<ImportInfo | null> {
  const packageJsonPath = checkPath(
    resolvePath('package.json', {
      root: projectRoot,
    })
  );
  if (packageJsonPath) {
    const packageJson = (await parseJsonFile(packageJsonPath)) as PackageJson;
    return packageJson.main
      ? {
          main: findPath(packageJson.main, {
            root: projectRoot,
          }),
          module: packageJson.module
            ? findPath(packageJson.module, {
                root: projectRoot,
              })
            : undefined,
        }
      : null;
  }
  return null;
}

async function importFromModule(
  registry: CocoonRegistry,
  mainModulePath: string,
  ecmaModulePath?: string
): Promise<ImportResult> {
  // We could just import modules like this:
  //
  // delete require.cache[mainModulePath];
  // const moduleExports = await import(mainModulePath);
  //
  // While easier, it has the drawback that we can't share dependencies.
  const time = process.hrtime();
  const moduleExports = (await compileModule(mainModulePath)).exports;
  const diff = process.hrtime(time);
  const importTimeInMs = diff[0] * 1e3 + Math.round(diff[1] / 1e6);
  return Object.keys(moduleExports)
    .map(
      (key): ImportResult | null => {
        const obj = moduleExports[key];
        if (objectIsNode(obj)) {
          registerCocoonNode(registry, key, obj);
          return {
            [key]: {
              importTimeInMs,
              module: mainModulePath,
            },
          };
        } else if (objectIsView(obj)) {
          if (!ecmaModulePath) {
            throw new Error(
              `package for view "${key}" does not export a "module" for view components`
            );
          }
          obj.component = ecmaModulePath;
          registerCocoonView(registry, key, obj);
          return {
            [key]: {
              component: ecmaModulePath,
              importTimeInMs,
              module: mainModulePath,
            },
          };
        }
        return null;
      }
    )
    .filter((x): x is ImportResult => Boolean(x))
    .reduce((all, x) => ({ ...all, ...x }), {});
}

/**
 * Compiles a node module from a file.
 * @param {string} modulePath The absolute path to the module file.
 */
async function compileModule(modulePath: string) {
  try {
    const code = await readFile(modulePath);
    // TODO: Danger zone! Using some private methods here. Figure out how to do
    // this with the public API.
    const paths = [
      path.resolve(__dirname, '../../../node_modules'),
      ...(Module as any)._nodeModulePaths(modulePath),
    ];
    const m = new Module(modulePath, module.parent!);
    m.filename = modulePath;
    m.paths = paths;
    (m as any)._compile(code, modulePath);
    return m;
  } catch (error) {
    error.message = `error importing "${modulePath}": ${error.message}`;
    throw error;
  }
}
