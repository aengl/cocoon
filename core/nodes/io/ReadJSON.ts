import { NodeObject } from '../../../common/node';

/**
 * Imports data from JSON files.
 */
export const ReadJSON: NodeObject = {
  category: 'I/O',

  in: {
    path: {
      hide: true,
      required: true,
    },
  },

  out: {
    data: {},
  },

  async process(context) {
    const { fs } = context;
    const filePath = context.ports.read<string>('path');
    const data = await fs.parseJsonFile(filePath, {
      root: context.definitions.root,
    });
    context.ports.writeAll({ data });
    return data.length
      ? `Imported ${data.length} items`
      : `Imported "${filePath}"`;
  },
};
