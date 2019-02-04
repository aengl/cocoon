import _ from 'lodash';
import { NodeObject } from '../../../common/node';

/**
 * Reads and evaluates a JS file.
 */
export const ReadJS: NodeObject = {
  category: 'I/O',

  in: {
    get: {},
    path: {
      required: true,
    },
  },

  out: {
    data: {},
  },

  async process(context) {
    const { fs } = context;
    const filePath = context.readFromPort<string>('path');
    const contents = await fs.readFile(filePath, context.definitionsRoot);
    // tslint:disable-next-line:no-eval
    const data = eval(contents);
    const get = context.readFromPort<string>('get');
    context.writeToPort('data', get ? _.get(data, get) : data);
    return `Imported "${filePath}"`;
  },
};
