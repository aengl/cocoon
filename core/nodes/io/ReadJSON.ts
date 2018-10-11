import path from 'path';
import { ICocoonNode, readInputPort, writeOutput } from '..';
import { Context } from '../../context';
import { parseJsonFile } from '../../fs';

const debug = require('debug')('cocoon:ReadJSON');

export interface IReadJSONConfig {}

/**
 * Imports data from JSON files.
 */
export class ReadJSON implements ICocoonNode<IReadJSONConfig> {
  in = {
    path: {
      required: true,
    },
  };

  out = {
    data: {},
  };

  public async process(config: IReadJSONConfig, context: Context) {
    const filePath = path.resolve(readInputPort(context.node, 'path'));
    const collection = parseJsonFile(filePath, context.definitionsPath);
    debug(`imported "${filePath}"`);
    writeOutput(context.node, 'data', collection);
  }
}
