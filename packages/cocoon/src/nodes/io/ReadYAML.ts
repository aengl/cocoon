import { CocoonNode } from '@cocoon/types';
import requestUri from '@cocoon/util/requestUri';
import got from 'got';
import yaml from 'js-yaml';

export interface Ports {
  uri: string;
}

export const ReadYAML: CocoonNode<Ports> = {
  category: 'I/O',
  description: `Reads YAML data.`,

  in: {
    uri: {
      required: true,
      visible: false,
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
      yaml.load
    );
    context.ports.write({ data });
    return data.length ? `Imported ${data.length} items` : `Imported "${uri}"`;
  },
};
