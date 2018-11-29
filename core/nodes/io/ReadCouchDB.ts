import got from 'got';
import _ from 'lodash';
import { readPersistedCache, writePersistedCache } from '..';
import { NodeObject } from '../../../common/node';

export interface CouchDBRow {
  id: string;
  key: string;
  value: {
    rev: string;
  };
  doc?: object;
}

export interface CouchDBDocument {
  _id: string;
  _rev: string;
  [key: string]: any;
}

export interface CouchDBResponse {
  offset: number;
  rows: CouchDBRow[];
  total_rows: number;
}

export interface CouchDBQueryResponse {
  bookmark: string;
  docs: CouchDBDocument[];
  warning: string;
}

/**
 * Imports databases from CouchDB.
 */
const ReadCouchDB: NodeObject = {
  in: {
    database: {
      required: true,
    },
    query: {},
    url: {},
  },

  out: {
    data: {},
  },

  async process(context) {
    const { node } = context;

    // Try to get data from persisted cache
    const persistedData = await readPersistedCache<object[]>(node, 'data');
    if (persistedData !== undefined) {
      context.writeToPort<object[]>('data', persistedData);
      return `Restored ${persistedData.length} documents from persisted cache`;
    }

    // Request from database
    const url = context.readFromPort<string>('url', 'http://localhost:5984');
    const database = context.readFromPort<string>('database');
    const query = context.readFromPort<object>('query');
    let data: object[];
    if (query !== undefined) {
      const requestUrl = `${url}/${database}/_find`;
      context.debug(`querying "${requestUrl}"`);
      _.defaults(query, { limit: 1000000 });
      const response: got.Response<CouchDBQueryResponse> = await got(
        requestUrl,
        {
          body: query,
          json: true,
          method: 'POST',
        }
      );
      checkResponse(response);
      data = response.body.docs;
    } else {
      const requestUrl = `${url}/${database}/_all_docs?include_docs=true`;
      context.debug(`fetching "${requestUrl}"`);
      const response: got.Response<CouchDBResponse> = await got(requestUrl, {
        json: true,
      });
      checkResponse(response);
      data = response.body.rows.map(item => item.doc!);
    }

    // Write data
    context.writeToPort<object[]>('data', data);

    // Persist data
    await writePersistedCache(node, 'data', data);

    return `Imported ${data.length} documents`;
  },
};

export { ReadCouchDB };

async function checkResponse(response: got.Response<any>) {
  if (!response.statusCode) {
    throw Error(`request failed`);
  }
  if (response.statusCode >= 400) {
    throw Error(`request failed with status ${response.statusCode}`);
  }
}
