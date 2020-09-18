import { CocoonNode } from '@cocoon/types';
import { Client, ClientConfig } from 'pg';

export interface Ports {
  config?: ClientConfig;
  query: string;
}

export const QueryPostgres: CocoonNode<Ports> = {
  description: `Executes a single SQL query and outputs the resulting rows into data. Supports the same environment variables as in https://www.postgresql.org/docs/9.1/libpq-envars.html.`,

  in: {
    config: {
      description: `Client configuration (see: https://node-postgres.com/api/client).`,
      visible: false,
    },
    query: {
      description: `The SQL query.`,
      required: true,
    },
  },

  out: {
    data: {},
  },

  category: 'I/O',

  async *process(context) {
    const { config, query } = context.ports.read();
    const client = new Client(config);
    yield `Connecting..`;
    await client.connect();
    yield 'Querying..';
    const res = await client.query(query);
    context.ports.write({ data: res.rows });
    await client.end();
    return res.rows ? `Queried ${res.rows.length} rows` : 'No results';
  },
};
