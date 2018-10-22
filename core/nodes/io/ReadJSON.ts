import { ICocoonNode, readInputPort, writeOutput } from '..';
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
    const filePath = readInputPort(context.node, 'path');
    const data = await parseJsonFile(filePath, context.definitionsPath);
    writeOutput(context.node, 'data', data);
    return data.length
      ? `imported ${data.length} item(s)`
      : `imported "${filePath}"`;
  },
};

export { ReadJSON };
