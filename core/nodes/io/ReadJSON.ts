import { parseJsonFile } from '../../../common/fs';
import { NodeObject } from '../../../common/node';

/**
 * Imports data from JSON files.
 */
const ReadJSON: NodeObject = {
  in: {
    path: {
      required: true,
    },
  },

  out: {
    data: {},
  },

  async process(context) {
    const filePath = context.readFromPort<string>('path');
    const data = await parseJsonFile(filePath, context.definitionsPath);
    context.writeToPort('data', data);
    return data.length
      ? `Imported ${data.length} items`
      : `Imported "${filePath}"`;
  },
};

export { ReadJSON };
