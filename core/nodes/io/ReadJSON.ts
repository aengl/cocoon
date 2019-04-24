import { NodeObject } from '../../../common/node';

export interface Ports {
  uri: string;
}

export const ReadJSON: NodeObject<Ports> = {
  category: 'I/O',
  description: `Imports data from a JSON file.`,

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
    const { uri } = context.ports.read();
    const data = await context.uri.parseJsonFileFromUri(uri);
    context.ports.write({ data });
    return data.length ? `Imported ${data.length} items` : `Imported "${uri}"`;
  },
};
