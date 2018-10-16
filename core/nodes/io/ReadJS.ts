import _ from 'lodash';
import { ICocoonNode, readInputPort, writeOutput } from '..';
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
    const filePath = readInputPort(context.node, 'path');
    const contents = await readFile(filePath, context.definitionsPath);
    // tslint:disable-next-line:no-eval
    const data = eval(contents);
    writeOutput(
      context.node,
      'data',
      context.config.get ? _.get(data, context.config.get) : data
    );
    return `imported "${filePath}"`;
  },
};

module.exports = { ReadJS };
