import { CocoonNode } from '@cocoon/types';
import requestUri from '@cocoon/util/requestUri';
import got, { Options } from 'got';
import { isArray } from 'lodash';

export interface Ports {
  options?: Options;
  uri: string;
}

export const ReadJSON: CocoonNode<Ports> = {
  category: 'I/O',
  description: `Reads JSON data.`,

  defaultActions: {
    'Open data source': 'open ${this.uri}',
  },

  in: {
    options: {
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
    const { options, uri } = context.ports.read();
    const data = await requestUri<JSON | JSON[]>(
      uri,
      async x => (await got(x, options as any)).body,
      x => JSON.parse(x)
    );
    context.ports.write({ data });
    return isArray(data)
      ? `Imported ${data.length} items`
      : `Imported "${uri}"`;
  },
};
