import { CocoonNode } from '@cocoon/types';
import requestUri from '@cocoon/util/requestUri';
import got from 'got';
import _ from 'lodash';

export interface Ports {
  get: string;
  uri: string;
}

export const ReadJS: CocoonNode<Ports> = {
  category: 'I/O',
  description: `Reads and evaluates a JS file.`,

  in: {
    get: {
      visible: false,
    },
    uri: {
      required: true,
      visible: false,
    },
  },

  out: {
    data: {},
  },

  async *process(context) {
    const ports = context.ports.read();
    const data = await requestUri(
      ports.uri,
      async x => (await got(x)).body,
      x => eval(x)
    );
    context.ports.write({ data: ports.get ? _.get(data, ports.get) : data });
    return `Imported "${ports.uri}"`;
  },
};
