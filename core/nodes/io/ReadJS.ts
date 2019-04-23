import _ from 'lodash';
import { NodeObject } from '../../../common/node';

export interface Ports {
  get: string;
  path: string;
}

/**
 * Reads and evaluates a JS file.
 */
export const ReadJS: NodeObject<Ports> = {
  category: 'I/O',

  in: {
    get: {
      hide: true,
    },
    path: {
      hide: true,
      required: true,
    },
  },

  out: {
    data: {},
  },

  async process(context) {
    const { fs } = context;
    const ports = context.ports.read();
    const contents = await fs.readFile(ports.path, {
      root: context.definitions.root,
    });
    // tslint:disable-next-line:no-eval
    const data = eval(contents);
    context.ports.write({ data: ports.get ? _.get(data, ports.get) : data });
    return `Imported "${ports.path}"`;
  },
};
