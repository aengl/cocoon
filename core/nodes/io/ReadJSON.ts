import { NodeObject } from '../../../common/node';

/**
 * Imports data from JSON files.
 */
export const ReadJSON: NodeObject = {
  category: 'I/O',

  in: {
    path: {
      required: true,
    },
  },

  out: {
    data: {},
  },

  async process(context) {
    const { fs } = context;
    const filePath = context.readFromPort<string>('path');
    const data = await fs.parseJsonFile(filePath, {
      root: context.definitionsRoot,
    });
    context.writeToPort('data', data);
    return data.length
      ? `Imported ${data.length} items`
      : `Imported "${filePath}"`;
  },
};
