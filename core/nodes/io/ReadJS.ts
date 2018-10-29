import _ from 'lodash';
import { ICocoonNode } from '..';
import { readFile } from '../../fs';

export interface IReadJSConfig {
  get: string;
}

/**
 * Reads and evaluates a JS file.
 */
const ReadJS: ICocoonNode<IReadJSConfig> = {
  in: {
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
    context.writeToPort(
      'data',
      context.config.get ? _.get(data, context.config.get) : data
    );
    return `imported "${filePath}"`;
  },
};

export { ReadJS };
