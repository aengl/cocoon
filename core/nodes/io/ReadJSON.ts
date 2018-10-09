import path from 'path';
import { ICocoonNode, readInputPort, writeOutput } from '..';
import { Context } from '../../context';
import { parseJsonFile } from '../../fs';

const debug = require('debug')('cocoon:ReadJSON');

export interface IReadJSONConfig {}

/**
 * Imports databases from JSON files.
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
    const filePath = path.resolve(readInputPort(context, 'path'));
    const collection = parseJsonFile(filePath, context.definitionsPath);
    debug(`imported ${collection.length} rows from "${filePath}"`);
    writeOutput(context, collection, 'data');
  }
}
