import { CocoonNode, CocoonRegistry } from '@cocoon/types';
import isCocoonNode from '@cocoon/util/isCocoonNode';
import isCocoonView from '@cocoon/util/isCocoonView';
import fs from 'fs';
import _ from 'lodash';
import Module from 'module';
import path from 'path';
import { PackageJson } from 'type-fest';
import { defaultNodes } from './nodes/index';
import { rollup } from 'rollup';
import loadConfigFile from 'rollup/dist/loadConfigFile';

const debug = require('debug')('cocoon:registry');

interface ImportInfo {
  module: string;
  component?: string;
}

interface CocoonPackageJson extends PackageJson {
  cocoon?: {
    nodes?: string[];
    rollup?: string | undefined;
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
  const nodeModuleImports = (
    await Promise.all(
      (
        await Promise.all(
          // TODO: using internal node APIs
          // https://github.com/nodejs/node/issues/5963
          ((Module as any)._nodeModulePaths(process.cwd()) as string[])
            .map(x => path.join(x, '@cocoon'))
            .map(tryReadDir)
        )
      )
        .flatMap(x => x!.files.map(y => path.resolve(x!.path, y)))
        .map(parsePackageJson)
    )
  )
    .flatMap(x => x.imports)
    .filter((x): x is ImportInfo => Boolean(x));

  // Collect nodes and views from definition package
  const definitionPackage = (await parsePackageJson(projectRoot)) || [];

  // Bundle package if necessary
  if (definitionPackage.rollup) {
    const configPath = path.resolve(projectRoot, definitionPackage.rollup);
    debug('creating rollup bundle using', configPath);
    const { options, warnings } = await loadConfigFile(configPath);
    warnings.flush();
    for (const optionsObj of options) {
      const bundle = await rollup(optionsObj);
      await Promise.all(optionsObj.output.map(bundle.write));
    }
  }

  // Import all collected nodes and views
  await Promise.all(
    _.uniqBy(
      [...nodeModuleImports, ...definitionPackage.imports],
      x => x.module
    ).map(x => importFromModule(registry, x.module, x.component))
  );

  const numNodes = Object.keys(registry.nodeImports).length;
  const numViews = Object.keys(registry.viewImports).length;
  if (numNodes || numViews) {
    debug(`imported ${numNodes} nodes and ${numViews} views`, registry);
  }
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
    nodeImports: {},
    nodes: {},
    viewImports: {},
    views: {},
  };
}

async function parsePackageJson(
  projectRoot: string
): Promise<{
  imports: ImportInfo[];
  rollup?: string;
}> {
  const packageJsonPath = path.resolve(projectRoot, 'package.json');
  try {
    const packageJson = JSON.parse(
      await fs.promises.readFile(packageJsonPath, { encoding: 'utf8' })
    ) as CocoonPackageJson;
    if (packageJson.cocoon) {
      return {
        imports: [
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
        ],
        // Rollup
        rollup: packageJson.cocoon.rollup
          ? path.resolve(packageJson.cocoon.rollup)
          : undefined,
      };
    }
  } catch (error) {
    debug(
      `error resolving package.json for Cocoon dependency at ${projectRoot}`
    );
    debug(error);
  }
  return { imports: [] };
}

async function importFromModule(
  registry: CocoonRegistry,
  modulePath: string,
  componentPath?: string
) {
  delete require.cache[require.resolve(modulePath)];
  const time = process.hrtime();
  const moduleExports = require(modulePath);
  const diff = process.hrtime(time);
  const importTimeInMs = diff[0] * 1e3 + Math.round(diff[1] / 1e6);
  Object.keys(moduleExports).forEach(key => {
    const obj = moduleExports[key];
    if (isCocoonNode(obj)) {
      registry.nodes[key] = obj;
      registry.nodeImports[key] = {
        importTimeInMs,
        module: modulePath,
      };
    } else if (isCocoonView(obj)) {
      if (!componentPath) {
        throw new Error(
          `package for view "${key}" did not specify a component`
        );
      }
      const resolvedComponentPath = require.resolve(componentPath);
      obj.component = resolvedComponentPath;
      registry.views[key] = obj;
      registry.viewImports[key] = {
        component: resolvedComponentPath,
        importTimeInMs,
        module: modulePath,
      };
    }
  });
}
