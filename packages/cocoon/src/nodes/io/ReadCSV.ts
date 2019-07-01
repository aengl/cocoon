import { CocoonNode } from '@cocoon/types';
import parse from 'csv-parse';
import _ from 'lodash';
import util from 'util';

export interface Ports {
  options: parse.Options;
  uri: string;
}

const parseAsync = util.promisify<string, parse.Options>(parse);

export const ReadCSV: CocoonNode<Ports> = {
  category: 'I/O',
  description: `Imports data from a CSV file.`,

  in: {
    options: {
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
    const { options, uri } = context.ports.read();
    const contents = await context.uri.readFileFromUri(uri);
    const data: any[] = (await parseAsync(
      contents,
      _.defaults(options, { delimiter: ',' })
    )) as any;
    context.ports.write({ data });
    return data.length ? `Imported ${data.length} items` : `Imported "${uri}"`;
  },
};
