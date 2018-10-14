import path from 'path';
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
    const filePath = path.resolve(readInputPort(context.node, 'path'));
    const collection = await parseJsonFile(filePath, context.definitionsPath);
    debug(`imported "${filePath}"`);
    writeOutput(context.node, 'data', collection);
  },
};

module.exports = { ReadJSON };
