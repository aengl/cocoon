import { NodeObject } from '../../../common/node';
import { parseJsonFile } from '../../fs';

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
    const filePath = context.readFromPort<string>('path');
    const data = await parseJsonFile(filePath, context.definitionsPath);
    context.writeToPort('data', data);
    return data.length
      ? `Imported ${data.length} items`
      : `Imported "${filePath}"`;
  },
};
