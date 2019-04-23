import _ from 'lodash';
import { NodeObject } from '../../../common/node';

export interface Ports {
  data: object[];
  defaults: object;
  limit: Limit;
  meta: CollectionMetaData;
}

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
export const CreateCollection: NodeObject<Ports> = {
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
    const { data, defaults, limit, meta } = context.ports.read();
    const numItems = data.length;
    const limitedData = limit
      ? _.orderBy(data, limit.orderBy, limit.orders).slice(0, limit.count)
      : data;
    const collection = {
      items: limitedData.map((item, i) => ({
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
    context.ports.write({ collection });
    return `Created collection with ${limitedData.length} items`;
  },
};
