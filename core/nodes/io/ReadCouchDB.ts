import got from 'got';
import { NodeObject, readPersistedCache, writePersistedCache } from '..';

/**
 * Imports databases from CouchDB.
 */
const ReadCouchDB: NodeObject = {
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
    await writePersistedCache(node, 'data', data);
    return `Imported ${response.body.total_rows} documents`;
  },
};

export { ReadCouchDB };
