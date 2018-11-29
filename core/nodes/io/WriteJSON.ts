import { writeJsonFile, writePrettyJsonFile } from '../../../common/fs';
import { NodeObject } from '../../../common/node';

/**
 * Writes data to a JSON file.
 */
const WriteJSON: NodeObject = {
  in: {
    data: {
      required: true,
    },
    path: {
      defaultValue: 'data.json',
    },
    pretty: {
      defaultValue: false,
    },
    stable: {
      defaultValue: false,
    },
  },

  async process(context) {
    const filePath = context.readFromPort<string>('path');
    const data = context.readFromPort('data');
    await (context.readFromPort<boolean>('pretty')
      ? writePrettyJsonFile(
          filePath,
          data,
          context.readFromPort<boolean>('stable'),
          context.definitionsPath,
          context.debug
        )
      : writeJsonFile(filePath, data, context.definitionsPath, context.debug));
    return data.length
      ? `Exported ${data.length} items`
      : `Exported "${filePath}"`;
  },
};

export { WriteJSON };
