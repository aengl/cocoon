import _ from 'lodash';
import { slugify } from '../../../common/nlp';
import { NodeObject } from '../../../common/node';

export interface Limit {
  count: number;
  orderBy: string[];
  orders?: Array<'asc' | 'desc'>;
}

export interface CollectionData {
  items: CollectionItem[];
  meta: CollectionMetaData;
}

export interface CollectionMetaData {
  layout: string;
  id: string;
  permalink: string;
  title: string;
  [key: string]: any;
}

export interface CollectionItem {
  layout: string;
  slug: string;
  [key: string]: any;
}

/**
 * Creates a Jekyll collection, with the data embedded into the front matter.
 */
export const JekyllCreateCollection: NodeObject = {
  category: 'I/O',

  in: {
    data: {
      required: true,
    },
    defaults: {
      defaultValue: {},
    },
    limit: {
      hide: true,
    },
    meta: {
      required: true,
    },
    slugKey: {
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
    const slugKey = context.ports.read<string>('slugKey');
    if (limit !== undefined) {
      data = _.orderBy(data, limit.orderBy, limit.orders).slice(0, limit.count);
    }
    context.ports.writeAll({
      collection: {
        items: data.map((item, i) => ({
          ...item,
          ...defaults,
          layout: 'details',
          slug: slugify(item[slugKey]),
        })),
        meta: _.defaults({}, meta, {
          data_size: numItems,
          last_modified_at: new Date().toDateString(),
          layout: 'default',
        }),
      },
    });
    return `Created collection with ${data.length} items`;
  },
};
