import { CocoonNode } from '@cocoon/types';
import got, { Response } from 'got';
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
  query: JSON;
  url: string;
}

export const ReadCouchDB: CocoonNode<Ports> = {
  category: 'I/O',
  description: `Imports a database from CouchDB.`,

  defaultActions: {
    'Open in Fauxton':
      'open ${this.url}/_utils/index.html#database/${this.database}/_all_docs',
  },

  in: {
    database: {
      visible: false,
    },
    query: {
      visible: false,
    },
    url: {
      defaultValue: 'http://localhost:5984',
      visible: false,
    },
  },

  out: {
    data: {},
  },

  persist: true,

  async *process(context) {
    const { database, query, url } = context.ports.read();
    let data: object[];
    if (query !== undefined) {
      const requestUrl = `${url}/${database}/_find`;
      context.debug(`querying "${requestUrl}"`);
      _.defaults(query, { limit: 1000000 });
      const response = await got
        .post(requestUrl, { json: query })
        .json<CouchDBQueryResponse>();
      data = response.docs;
    } else {
      const requestUrl = `${url}/${database}/_all_docs?include_docs=true`;
      context.debug(`fetching "${requestUrl}"`);
      const response = await got(requestUrl).json<CouchDBResponse>();
      data = response.rows.map(item => item.doc!);
    }
    context.ports.write({ data });
    return `Imported ${data.length} documents`;
  },
};
