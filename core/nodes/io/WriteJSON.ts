import { ICocoonNode, readInputPort } from '..';
import { writeJsonFile, writePrettyJsonFile } from '../../fs';

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

  process: async context => {
    const filePath = readInputPort(context.node, 'path');
    const data = readInputPort(context.node, 'data');
    await (context.config.pretty
      ? writePrettyJsonFile(
          filePath,
          data,
          context.config.stable,
          context.definitionsPath,
          context.debug
        )
      : writeJsonFile(filePath, data, context.definitionsPath, context.debug));
    return data.length
      ? `exported ${data.length} item(s)`
      : `exported "${filePath}"`;
  },
};

module.exports = { WriteJSON };
