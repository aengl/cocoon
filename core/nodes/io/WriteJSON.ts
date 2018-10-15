import { ICocoonNode, readInputPort } from '..';
import { Context } from '../../context';
import { writeJsonFile, writePrettyJsonFile } from '../../fs';

const debug = require('debug')('cocoon:WriteJSON');

export interface IWriteJSONConfig {
  pretty?: boolean;
  stable?: boolean;
}

/**
 * Writes data to a JSON file.
 */
const WriteJSON: ICocoonNode<IWriteJSONConfig> = {
  in: {
    data: {
      required: true,
    },
    path: {
      defaultValue: 'data.json',
    },
  },

  process: async (config: IWriteJSONConfig, context: Context) => {
    const filePath = readInputPort(context.node, 'path');
    const data = readInputPort(context.node, 'data');
    await (config.pretty
      ? writePrettyJsonFile(
          filePath,
          data,
          config.stable,
          context.definitionsPath,
          debug
        )
      : writeJsonFile(filePath, data, context.definitionsPath, debug));
  },
};

module.exports = { WriteJSON };
