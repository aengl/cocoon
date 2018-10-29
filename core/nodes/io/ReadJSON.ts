import { ICocoonNode } from '..';
import { parseJsonFile } from '../../fs';

export interface IReadJSONConfig {}

/**
 * Imports data from JSON files.
 */
const ReadJSON: ICocoonNode<IReadJSONConfig> = {
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
