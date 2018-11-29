import _ from 'lodash';
import { readFile } from '../../../common/fs';
import { NodeObject } from '../../../common/node';

/**
 * Reads and evaluates a JS file.
 */
const ReadJS: NodeObject = {
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
    const filePath = context.readFromPort<string>('path');
    const contents = await readFile(filePath, context.definitionsPath);
    // tslint:disable-next-line:no-eval
    const data = eval(contents);
    const get = context.readFromPort<string>('get');
    context.writeToPort('data', get ? _.get(data, get) : data);
    return `Imported "${filePath}"`;
  },
};

export { ReadJS };
