import { CocoonNode, CocoonRegistry } from '@cocoon/types';
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
  module: string;
  component?: string;
}

interface ImportResult {
  [node: string]: {
    module: string;
    importTimeInMs: number;
    component?: string;
  };
}

interface CocoonPackageJson extends PackageJson {
  cocoon?: {
    nodes?: string[];
    views?: Array<{
      module: string;
      component: string;
    }>;
  };
}

export async function createAndInitialiseRegistry(projectRoot: string) {
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

  // Collect nodes and views from `node_modules`
  const nodeModuleImports = _.flatten<ImportInfo | null>(
    await Promise.all(
      (await Promise.all(
        // TODO: using internal node APIs
        // https://github.com/nodejs/node/issues/5963
        ((Module as any)._nodeModulePaths(process.cwd()) as string[])
          .map(x => path.join(x, '@cocoon'))
          .map(tryReadDir)
      ))
        .flatMap(x => x!.files.map(y => path.resolve(x!.path, y)))
        .map(parsePackageJson)
    )
  ).filter((x): x is ImportInfo => Boolean(x));

  // Collect nodes and views from definition package
  const packageImports = (await parsePackageJson(projectRoot)) || [];

  // Import all collected nodes and views
  const importResults = (await Promise.all(
    _.uniqBy([...nodeModuleImports, ...packageImports], x => x.module).map(x =>
      importFromModule(registry, x.module, x.component)
    )
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
): Promise<ImportInfo[] | null> {
  const packageJsonPath = path.resolve(projectRoot, 'package.json');
  try {
    const packageJson = JSON.parse(
      await fs.promises.readFile(packageJsonPath, { encoding: 'utf8' })
    ) as CocoonPackageJson;
    return packageJson.cocoon
      ? [
          // Nodes
          ...(packageJson.cocoon.nodes
            ? packageJson.cocoon.nodes.map(x => ({
                module: path.resolve(projectRoot, x),
              }))
            : []),
          // Views
          ...(packageJson.cocoon.views
            ? packageJson.cocoon.views.map(x => ({
                component: path.resolve(projectRoot, x.component),
                module: path.resolve(projectRoot, x.module),
              }))
            : []),
        ]
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
  modulePath: string,
  componentPath?: string
): Promise<ImportResult> {
  // We could just import modules like this:
  //
  // delete require.cache[modulePath];
  // const moduleExports = await import(modulePath);
  //
  // While easier, it has the drawback that we can't share dependencies.
  const time = process.hrtime();
  const moduleExports = (await compileModule(modulePath)).exports;
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
            module: modulePath,
          },
        };
      } else if (isCocoonView(obj)) {
        if (!componentPath) {
          throw new Error(
            `package for view "${key}" did not specify a component`
          );
        }
        obj.component = componentPath;
        registry.views[key] = obj;
        return {
          [key]: {
            component: componentPath,
            importTimeInMs,
            module: modulePath,
          },
        };
      }
      return null;
    })
    .filter((x): x is ImportResult => Boolean(x))
    .reduce((acc, x) => _.assign(acc, x), {});
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
