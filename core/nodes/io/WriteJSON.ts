import { CocoonNode } from '../../../common/node';

export interface Ports {
  data: object[];
  path: string;
  pretty: boolean;
  stable: boolean;
}

export const WriteJSON: CocoonNode<Ports> = {
  category: 'I/O',
  description: `Writes a collection to a JSON file.`,

  in: {
    data: {
      required: true,
    },
    path: {
      defaultValue: 'data.json',
      hide: true,
    },
    pretty: {
      defaultValue: false,
      hide: true,
    },
    stable: {
      defaultValue: false,
      hide: true,
    },
  },

  out: {
    path: {},
  },

  async process(context) {
    const { fs } = context;
    const { data, path: filePath, pretty, stable } = context.ports.read();
    const jsonPath = await (pretty
      ? fs.writePrettyJsonFile(filePath, data, {
          debug: context.debug,
          root: context.definitions.root,
          stable,
        })
      : fs.writeJsonFile(filePath, data, {
          debug: context.debug,
          root: context.definitions.root,
        }));
    context.ports.write({ path: jsonPath });
    return data.length
      ? `Exported ${data.length} items`
      : `Exported "${filePath}"`;
  },
};
