import got from 'got';
import { NodeObject } from '../../../common/node';

export interface Ports {
  uri: string;
}

/**
 * Imports data from JSON files.
 */
export const ReadJSON: NodeObject<Ports> = {
  category: 'I/O',

  in: {
    uri: {
      hide: true,
      required: true,
    },
  },

  out: {
    data: {},
  },

  async process(context) {
    const { fs } = context;

    // Parse URI
    const { uri } = context.ports.read();
    let url: URL;
    try {
      url = new URL(uri);
    } catch {
      url = new URL(`file://${uri}`);
    }

    // Read data from file or URL
    let data: any;
    if (url.protocol.startsWith('file')) {
      data = await fs.parseJsonFile(url.pathname, {
        root: context.definitions.root,
      });
    } else {
      const { body } = await got(url.href, { json: true });
      data = body;
    }

    context.ports.write({ data });
    return data.length ? `Imported ${data.length} items` : `Imported "${uri}"`;
  },
};
