import fs from 'fs';
import _ from 'lodash';
import open from 'open';

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
  const nodePath = `nodes/${name}${typescript ? '.ts' : '.js'}`;
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
    nodes: [name],
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
  const modulePath = `views/${name}${typescript ? '.ts' : '.js'}`;
  const componentPath = `components/${name}.tsx`;
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
        module: modulePath,
        // tslint:disable-next-line:object-literal-sort-keys
        component: componentPath,
      },
    ],
  });
  await open(modulePath);
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
