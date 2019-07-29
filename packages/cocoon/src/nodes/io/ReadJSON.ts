import { CocoonNode } from '@cocoon/types';
import requestUri from '@cocoon/util/requestUri';
import got from 'got';

export interface Ports {
  options?: got.GotOptions<any>;
  uri: string;
}

export const ReadJSON: CocoonNode<Ports> = {
  category: 'I/O',
  description: `Reads JSON data.`,

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
    const data = await requestUri(
      uri,
      async x =>
        (await got(x, {
          json: true,
          ...(options || {}),
        })).body,
      x => x
    );
    context.ports.write({ data });
    return data.length ? `Imported ${data.length} items` : `Imported "${uri}"`;
  },
};
