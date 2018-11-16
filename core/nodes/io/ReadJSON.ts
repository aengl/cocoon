import { NodeObject } from '..';
import { parseJsonFile } from '../../fs';

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

  process: async context => {
    const filePath = context.readFromPort<string>('path');
    const data = await parseJsonFile(filePath, context.definitionsPath);
    context.writeToPort('data', data);
    return data.length
      ? `imported ${data.length} item(s)`
      : `imported "${filePath}"`;
  },
};

export { ReadJSON };
