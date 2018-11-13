import got from 'got';
import { ICocoonNode } from '..';

/**
 * Imports databases from CouchDB.
 */
const ReadCouchDB: ICocoonNode = {
  in: {
    config: {
      defaultValue: {},
    },
    database: {
      required: true,
    },
    url: {},
  },

  out: {
    data: {},
  },

  process: async context => {
    // Try to get data from persisted cache
    const persistedData = await context.readPersistedCache<object[]>('data');
    if (persistedData) {
      context.writeToPort<object[]>('data', persistedData);
      return `restored ${
        persistedData.length
      } document(s) from persisted cache`;
    }

    // Request from database
    const url = context.readFromPort<string>('url', 'http://localhost:5984');
    const database = context.readFromPort<string>('database');
    const requestUrl = `${url}/${database}/_all_docs?include_docs=true`;
    context.debug(`fetching "${requestUrl}"`);
    const response = await got(requestUrl, {
      json: true,
      ...context.readFromPort<object>('config'),
    });
    if (!response.statusCode) {
      throw Error(`request failed`);
    }
    if (response.statusCode >= 400) {
      throw Error(`request failed with status ${response.statusCode}`);
    }
    const data = response.body.rows.map(item => item.doc);
    context.writeToPort<object[]>('data', data);
    await context.writePersistedCache('data', data);
    return `imported ${response.body.total_rows} document(s)`;
  },
};

export { ReadCouchDB };
