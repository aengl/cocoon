import fs from 'fs';
import _ from 'lodash';

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
    _.get(packageJson, 'cocoon.nodes', []).indexOf(name) >= 0 ||
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

  // Update package.json
  fs.promises.writeFile(
    'package.json',
    JSON.stringify(
      _.mergeWith(
        packageJson,
        {
          cocoon: {
            nodes: [name],
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

async function readPackageJson() {
  return JSON.parse(await fs.promises.readFile('./package.json', 'utf8'));
}
