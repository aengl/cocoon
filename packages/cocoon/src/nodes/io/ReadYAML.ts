import { CocoonNode } from '@cocoon/types';
import requestUri from '@cocoon/util/requestUri';
import got from 'got';
import yaml from 'js-yaml';

export interface Ports {
  options?: got.GotOptions<any>;
  uri: string;
}

export const ReadYAML: CocoonNode<Ports> = {
  category: 'I/O',
  description: `Reads YAML data.`,

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
      async x => (await got(x, options || {})).body,
      x => yaml.safeLoad(x)
    );
    context.ports.write({ data });
    return data.length ? `Imported ${data.length} items` : `Imported "${uri}"`;
  },
};
