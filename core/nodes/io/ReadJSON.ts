import { ICocoonNode, readInputPort, writeOutput } from '..';
import { Context } from '../../context';
import { parseJsonFile } from '../../fs';

const debug = require('debug')('cocoon:ReadJSON');

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

  process: async (config: IReadJSONConfig, context: Context) => {
    const filePath = readInputPort(context.node, 'path');
    const data = await parseJsonFile(filePath, context.definitionsPath);
    writeOutput(context.node, 'data', data);
    return data.length
      ? `imported ${data.length} item(s)`
      : `imported "${filePath}"`;
  },
};

module.exports = { ReadJSON };
