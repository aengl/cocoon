import got from 'got';
import { ICocoonNode, readInputPort, writeOutput } from '..';
import { Context } from '../../context';

const debug = require('debug')('cocoon:ReadCouchDB');

export interface IReadCouchDBConfig extends got.GotJSONOptions {}

/**
 * Imports databases from CouchDB.
 */
export class ReadCouchDB implements ICocoonNode<IReadCouchDBConfig> {
  in = {
    database: {
      required: true,
    },
    url: {},
  };

  out = {
    data: {},
  };

  public async process(config: IReadCouchDBConfig, context: Context) {
    const url = readInputPort(context.node, 'path', 'http://localhost:5984');
    const database = readInputPort(context.node, 'database');
    const requestUrl = `${url}/${database}/_all_docs?include_docs=true`;
    debug(`fetching "${requestUrl}"`);
    debug(config);
    const response = await got(requestUrl, { json: true, ...config });
    if (!response.statusCode) {
      throw Error(`request failed`);
    }
    if (response.statusCode >= 400) {
      throw Error(`request failed with status ${response.statusCode}`);
    }
    debug(`got ${response.body.total_rows} document(s)`);
    writeOutput(context.node, 'data', response.body.rows.map(item => item.doc));
  }
}
