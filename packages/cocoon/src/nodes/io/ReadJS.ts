import { CocoonNode } from '@cocoon/types';
import _ from 'lodash';

export interface Ports {
  get: string;
  path: string;
}

export const ReadJS: CocoonNode<Ports> = {
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
    const contents = await context.uri.readFileFromUri(ports.path);
    // tslint:disable-next-line:no-eval
    const data = eval(contents);
    context.ports.write({ data: ports.get ? _.get(data, ports.get) : data });
    return `Imported "${ports.path}"`;
  },
};
