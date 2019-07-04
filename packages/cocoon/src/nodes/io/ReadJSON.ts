import { CocoonNode } from '@cocoon/types';
import requestUri from '@cocoon/util/requestUri';
import got from 'got';

export interface Ports {
  uri: string;
}

export const ReadJSON: CocoonNode<Ports> = {
  category: 'I/O',
  description: `Reads JSON data.`,

  in: {
    uri: {
      hide: true,
      required: true,
    },
  },

  out: {
    data: {},
  },

  async *process(context) {
    const { uri } = context.ports.read();
    const data = await requestUri(
      uri,
      async x => (await got(x)).body,
      JSON.parse
    );
    context.ports.write({ data });
    return data.length ? `Imported ${data.length} items` : `Imported "${uri}"`;
  },
};
