import { CocoonNode } from '@cocoon/types';
import got from 'got';
import _ from 'lodash';

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

export interface Ports {
  database: string;
  query: string;
  url: string;
}

export const ReadCouchDB: CocoonNode<Ports> = {
  category: 'I/O',
  description: `Imports a database from CouchDB.`,

  in: {
    database: {
      hide: true,
    },
    query: {
      hide: true,
    },
    url: {
      defaultValue: 'http://localhost:5984',
      hide: true,
    },
  },

  out: {
    data: {},
  },

  persist: true,

  async process(context) {
    const { database, query, url } = context.ports.read();
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
        } as any
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
    context.ports.write({ data });
    return `Imported ${data.length} documents`;
  },
};

async function checkResponse(response: got.Response<any>) {
  if (!response.statusCode) {
    throw Error(`request failed`);
  }
  if (response.statusCode >= 400) {
    throw Error(`request failed with status ${response.statusCode}`);
  }
}
