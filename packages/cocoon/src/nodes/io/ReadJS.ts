import { CocoonNode } from '@cocoon/types';
import requestUri from '@cocoon/util/requestUri';
import got from 'got';
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
    const data = await requestUri(
      ports.path,
      async x => (await got(x)).body,
      // tslint:disable-next-line:no-eval
      x => eval(x)
    );
    context.ports.write({ data: ports.get ? _.get(data, ports.get) : data });
    return `Imported "${ports.path}"`;
  },
};
