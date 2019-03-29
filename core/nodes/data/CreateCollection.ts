import _ from 'lodash';
import { NodeObject } from '../../../common/node';

export interface Limit {
  count: number;
  orderBy: string[];
  orders?: Array<'asc' | 'desc'>;
}

export interface CollectionData {
  items: any[];
  meta: CollectionMetaData;
}

export interface CollectionMetaData {
  layout: string;
  id: string;
  permalink: string;
  title: string;
  [key: string]: any;
}

/**
 * Creates a data collection for publishing. Used in combination with
 * `PublishCollections`.
 */
export const CreateCollection: NodeObject = {
  category: 'I/O',

  in: {
    data: {
      required: true,
    },
    defaults: {
      defaultValue: {},
      hide: true,
    },
    limit: {
      hide: true,
    },
    meta: {
      hide: true,
      required: true,
    },
  },

  out: {
    collection: {},
  },

  defaultPort: {
    incoming: false,
    name: 'collection',
  },

  async process(context) {
    let data = context.ports.read<object[]>('data');
    const numItems = data.length;
    const defaults = context.ports.read<object>('defaults');
    const limit = context.ports.read<Limit>('limit');
    const meta = context.ports.read<CollectionMetaData>('meta');
    if (limit !== undefined) {
      data = _.orderBy(data, limit.orderBy, limit.orders).slice(0, limit.count);
    }
    const collection = {
      items: data.map((item, i) => ({
        ...item,
        ...defaults,
      })),
      meta: _.defaults({}, meta, {
        data_size: numItems,
        last_modified_at: new Date().toDateString(),
      }),
    };
    if (!collection.meta.id) {
      throw new Error(`collection metadata is missing an "id" field`);
    }
    context.ports.writeAll({ collection });
    return `Created collection with ${data.length} items`;
  },
};
