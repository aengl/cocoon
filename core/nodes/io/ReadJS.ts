import _ from 'lodash';
import { ICocoonNode } from '..';
import { readFile } from '../../fs';

/**
 * Reads and evaluates a JS file.
 */
const ReadJS: ICocoonNode = {
  in: {
    get: {},
    path: {
      required: true,
    },
  },

  out: {
    data: {},
  },

  process: async context => {
    const filePath = context.readFromPort<string>('path');
    const contents = await readFile(filePath, context.definitionsPath);
    // tslint:disable-next-line:no-eval
    const data = eval(contents);
    const get = context.readFromPort<string>('get');
    context.writeToPort('data', get ? _.get(data, get) : data);
    return `imported "${filePath}"`;
  },
};

export { ReadJS };
