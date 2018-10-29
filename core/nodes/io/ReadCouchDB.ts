import got from 'got';
import { ICocoonNode } from '..';

export interface IReadCouchDBConfig extends got.GotJSONOptions {}

/**
 * Imports databases from CouchDB.
 */
const ReadCouchDB: ICocoonNode<IReadCouchDBConfig> = {
  in: {
    database: {
      required: true,
    },
    url: {},
  },

  out: {
    data: {},
  },

  process: async context => {
    const url = context.readFromPort<string>('url', 'http://localhost:5984');
    const database = context.readFromPort<string>('database');
    const requestUrl = `${url}/${database}/_all_docs?include_docs=true`;
    context.debug(`fetching "${requestUrl}"`);
    const response = await got(requestUrl, { json: true, ...context.config });
    if (!response.statusCode) {
      throw Error(`request failed`);
    }
    if (response.statusCode >= 400) {
      throw Error(`request failed with status ${response.statusCode}`);
    }
    context.writeToPort<object[]>(
      'data',
      response.body.rows.map(item => item.doc)
    );
    return `imported ${response.body.total_rows} document(s)`;
  },
};

export { ReadCouchDB };
