import { CocoonFileInfo, CocoonNode, CocoonRegistry } from '@cocoon/types';
import isCocoonNode from '@cocoon/util/isCocoonNode';
import isCocoonView from '@cocoon/util/isCocoonView';
import fs from 'fs';
import _ from 'lodash';
import Module from 'module';
import path from 'path';
import { PackageJson } from 'type-fest';
import { defaultNodes } from './nodes';

const debug = require('debug')('cocoon:registry');

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

export async function createAndInitialiseRegistry(definitions: CocoonFileInfo) {
  debug(`creating node registry`);
  const registry = createEmptyRegistry();

  // Register built-in nodes
  _.sortBy(
    Object.keys(defaultNodes)
      .filter(key => isCocoonNode(defaultNodes[key]))
      .map(type => ({
        node: defaultNodes[type] as CocoonNode,
        type,
      })),
    'type'
  ).forEach(x => (registry.nodes[x.type] = x.node));

  // Find JS modules in special sub-folders for nodes
  const folderImports = (await Promise.all(
    ['nodes', '.cocoon/nodes'].map(tryReadDir)
  ))
    .flatMap(x =>
      x.files.filter(y => y.endsWith('.js')).map(y => path.resolve(x.path, y))
    )
    .map((x): ImportInfo | null => (x ? { main: x } : null));

  // Collect nodes and views from `node_modules`
  const nodeModuleImports = await Promise.all(
    (await Promise.all(
      // TODO: using internal node APIs
      // https://github.com/nodejs/node/issues/5963
      ((Module as any)._nodeModulePaths(process.cwd()) as string[])
        .map(x => path.join(x, '@cocoon'))
        .map(tryReadDir)
    ))
      .flatMap(x => x!.files.map(y => path.resolve(x!.path, y)))
      .map(parsePackageJson)
  );

  // Collect nodes and views from definition package
  const packageImport = await parsePackageJson(definitions.root);

  // Import all collected nodes and views
  const importResults = (await Promise.all(
    [...folderImports, ...nodeModuleImports, packageImport]
      .filter((x): x is ImportInfo => Boolean(x))
      .map(x => importFromModule(registry, x.main, x.module))
  )).reduce((all, x) => ({ ...all, ...x }), {});

  debug('imported nodes and views', importResults);
  debug('created registry', registry);
  return registry;
}

async function tryReadDir(dir: string) {
  try {
    return {
      files: await fs.promises.readdir(dir),
      path: dir,
    };
  } catch (error) {
    return {
      files: [],
      path: dir,
    };
  }
}

function createEmptyRegistry(): CocoonRegistry {
  return {
    nodes: {},
    views: {},
  };
}

async function parsePackageJson(
  projectRoot: string
): Promise<ImportInfo | null> {
  const packageJsonPath = path.resolve(projectRoot, 'package.json');
  try {
    const packageJson = JSON.parse(
      await fs.promises.readFile(packageJsonPath, { encoding: 'utf8' })
    ) as PackageJson;
    return packageJson.main
      ? {
          main: path.resolve(projectRoot, packageJson.main),
          module: packageJson.module
            ? path.resolve(projectRoot, packageJson.module)
            : undefined,
        }
      : null;
  } catch (error) {
    debug(
      `error resolving package.json for Cocoon dependency at ${projectRoot}`
    );
    debug(error);
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
    .map((key): ImportResult | null => {
      const obj = moduleExports[key];
      if (isCocoonNode(obj)) {
        registry.nodes[key] = obj;
        return {
          [key]: {
            importTimeInMs,
            module: mainModulePath,
          },
        };
      } else if (isCocoonView(obj)) {
        if (!ecmaModulePath) {
          throw new Error(
            `package for view "${key}" does not export a "module" for view components`
          );
        }
        obj.component = ecmaModulePath;
        registry.views[key] = obj;
        return {
          [key]: {
            component: ecmaModulePath,
            importTimeInMs,
            module: mainModulePath,
          },
        };
      }
      return null;
    })
    .filter((x): x is ImportResult => Boolean(x))
    .reduce((all, x) => ({ ...all, ...x }), {});
}

/**
 * Compiles a node module from a file.
 * @param {string} modulePath The absolute path to the module file.
 */
async function compileModule(modulePath: string) {
  try {
    const code = await fs.promises.readFile(modulePath, { encoding: 'utf8' });
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
