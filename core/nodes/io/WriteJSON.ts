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
    },
    pretty: {
      defaultValue: false,
    },
    stable: {
      defaultValue: false,
    },
  },

  out: {
    path: {},
  },

  async process(context) {
    const { fs } = context;
    const filePath = context.readFromPort<string>('path');
    const data = context.readFromPort('data');
    const jsonPath = await (context.readFromPort<boolean>('pretty')
      ? fs.writePrettyJsonFile(filePath, data, {
          debug: context.debug,
          root: context.definitions.root,
          stable: context.readFromPort<boolean>('stable'),
        })
      : fs.writeJsonFile(filePath, data, {
          debug: context.debug,
          root: context.definitions.root,
        }));
    context.writeToPort('path', jsonPath);
    return data.length
      ? `Exported ${data.length} items`
      : `Exported "${filePath}"`;
  },
};
