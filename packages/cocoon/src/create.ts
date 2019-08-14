import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import _ from 'lodash';
import open from 'open';
import path from 'path';

export async function createNode(
  name,
  {
    typescript = false,
  }: {
    typescript?: boolean;
  } = {}
) {
  const packageJson = await readPackageJson();

  // Check if the node already exists
  const nodeBasePath = `nodes/${name}`;
  const nodePath = `${nodeBasePath}${typescript ? '.ts' : '.js'}`;
  if (
    _.get(packageJson, 'cocoon.nodes', []).indexOf(nodePath) >= 0 ||
    fs.existsSync(nodePath)
  ) {
    throw new Error(`node "${name}" already exists`);
  }

  // Create source file
  try {
    await fs.promises.mkdir('nodes');
  } catch {
    // Ignore error
  }
  await fs.promises.writeFile(
    nodePath,
    typescript
      ? `import { CocoonNode } from '@cocoon/types';

export interface Ports {
  data: unknown[];
}

export const ${name}: CocoonNode<Ports> = {
  in: {
    data: {
      required: true,
    },
  },

  async *process(context) {
    const { data } = context.ports.read();
    return \`Processed \${data.length} items\`;
  },
};
`
      : `module.exports.${name} = {
  in: {
    data: {
      required: true,
    },
  },

  async *process(context) {
    const { data } = context.ports.read();
    return \`Processed \${data.length} items\`;
  },
};
`
  );

  await updatePackageJson(packageJson, {
    nodes: [nodeBasePath],
  });
  await open(nodePath);
}

export async function createView(
  name,
  {
    typescript = false,
  }: {
    typescript?: boolean;
  } = {}
) {
  const packageJson = await readPackageJson();

  // Check if the view already exists
  const moduleBasePath = `views/${name}`;
  const modulePath = `${moduleBasePath}}${typescript ? '.ts' : '.js'}`;
  const componentBasePath = `components/${name}`;
  const componentPath = `${componentBasePath}.tsx`;
  if (
    _.get(packageJson, 'cocoon.views', []).some(
      x => x.module === modulePath || x.component === componentPath
    ) ||
    fs.existsSync(modulePath) ||
    fs.existsSync(componentPath)
  ) {
    throw new Error(`view "${name}" already exists`);
  }

  // Create source files
  try {
    await fs.promises.mkdir('views');
    await fs.promises.mkdir('components');
  } catch {
    // Ignore error
  }
  await fs.promises.writeFile(
    modulePath,
    typescript
      ? `import { CocoonView, CocoonViewProps } from '@cocoon/types';

export type ViewData = unknown[];

export interface ViewState {}

export type Props = CocoonViewProps<ViewData, ViewState>;

export const ${name}: CocoonView<ViewData, ViewState> = {
  serialiseViewData: async (context, data: unknown[], state) => data,
};
`
      : `module.exports.${name} = {
  serialiseViewData: async (context, data, state) => data,
};
`
  );
  await fs.promises.writeFile(
    componentPath,
    typescript
      ? `import React from 'react';
import { Props } from '../views/${name}';

export const ${name} = (props: Props) => {
  const { isPreview, viewData, viewState } = props;
  return <div></div>;
};
`
      : `import React from 'react';

export const ${name} = (props) => {
  const { isPreview, viewData, viewState } = props;
  return <div></div>;
`
  );

  await updatePackageJson(packageJson, {
    views: [
      {
        module: moduleBasePath,
        // tslint:disable-next-line:object-literal-sort-keys
        component: componentBasePath,
      },
    ],
  });
  await open(modulePath);
}

export async function createProject(
  name: string,
  {
    version,
    yarn = false,
  }: {
    version?: string;
    yarn?: boolean;
  } = {}
) {
  if (fs.existsSync(name)) {
    throw new Error(`folder "${name}" already exists`);
  }
  const versionOrLatest = version || 'latest';
  await fs.promises.mkdir(name);
  await fs.promises.writeFile(
    path.join(name, 'package.json'),
    `{
    "name": "${name}",
    "private": true,
    "version": "1.0.0",
    "cocoon": {
      "nodes": [],
      "views": []
    },
    "devDependencies": {
      "@cocoon/editor": "${versionOrLatest}",
      "@cocoon/rollup": "${versionOrLatest}",
      "@cocoon/types": "${versionOrLatest}"
    },
    "scripts": {
      "build": "rollup --config rollup.config.js",
      "dev": "rollup --config rollup.config.js --watch",
      "editor": "cocoon-editor cocoon.yml"
    }
  }
`
  );
  await fs.promises.writeFile(
    path.join(name, 'tsconfig.json'),
    `{
  "compilerOptions": {
    "target": "esnext"
  },
  "exclude": ["__tests__", "**/node_modules", "**/*.test.ts"]
}
`
  );
  await fs.promises.writeFile(path.join(name, 'cocoon.yml'), '');
  const childProcess = spawn(yarn ? 'yarn' : 'npm', yarn ? [] : ['install'], {
    cwd: path.resolve(name),
    stdio: [process.stdin, process.stdout, process.stderr],
  });
  await waitForProcess(childProcess);
}

async function readPackageJson() {
  return JSON.parse(await fs.promises.readFile('./package.json', 'utf8'));
}

async function updatePackageJson(packageJson: string, data: object) {
  return fs.promises.writeFile(
    'package.json',
    JSON.stringify(
      _.mergeWith(
        packageJson,
        {
          cocoon: {
            ...data,
          },
        },
        (objValue, srcValue) =>
          _.isArray(objValue) ? objValue.concat(srcValue) : undefined
      ),
      undefined,
      2
    )
  );
}

function waitForProcess(childProcess: ChildProcess) {
  return new Promise((resolve, reject) => {
    childProcess.once('exit', (code: number, signal: string) =>
      code === 0
        ? resolve()
        : reject(new Error('installation failed with code: ' + code))
    );
    childProcess.once('error', (err: Error) => reject(err));
  });
}
