import { NodeObject } from '../../../common/node';

/**
 * Writes data to a JSON file.
 */
export const WriteJSON: NodeObject = {
  category: 'I/O',

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
    const filePath = context.ports.read<string>('path');
    const data = context.ports.read('data');
    const jsonPath = await (context.ports.read<boolean>('pretty')
      ? fs.writePrettyJsonFile(filePath, data, {
          debug: context.debug,
          root: context.definitions.root,
          stable: context.ports.read<boolean>('stable'),
        })
      : fs.writeJsonFile(filePath, data, {
          debug: context.debug,
          root: context.definitions.root,
        }));
    context.ports.writeAll({ path: jsonPath });
    return data.length
      ? `Exported ${data.length} items`
      : `Exported "${filePath}"`;
  },
};
