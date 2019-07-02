import { CocoonNode } from '@cocoon/types';
import requestUri from '@cocoon/util/requestUri';
import parse from 'csv-parse';
import got from 'got';
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
    const data = await requestUri<any[]>(
      uri,
      async x => (await got(x)).body,
      async x =>
        (await parseAsync(x, _.defaults(options, { delimiter: ',' }))) as any
    );
    context.ports.write({ data });
    return data.length ? `Imported ${data.length} items` : `Imported "${uri}"`;
  },
};
