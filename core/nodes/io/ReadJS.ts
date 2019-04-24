import _ from 'lodash';
import { NodeObject } from '../../../common/node';

export interface Ports {
  get: string;
  path: string;
}

export const ReadJS: NodeObject<Ports> = {
  category: 'I/O',
  description: `Reads and evaluates a JS file.`,

  in: {
    get: {
      hide: true,
    },
    uri: {
      hide: true,
      required: true,
    },
  },

  out: {
    data: {},
  },

  async process(context) {
    const ports = context.ports.read();
    const contents = await context.uri.readFileFromUri(ports.path, {
      root: context.definitions.root,
    });
    // tslint:disable-next-line:no-eval
    const data = eval(contents);
    context.ports.write({ data: ports.get ? _.get(data, ports.get) : data });
    return `Imported "${ports.path}"`;
  },
};
