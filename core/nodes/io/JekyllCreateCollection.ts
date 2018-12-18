import _ from 'lodash';
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
  position: number;
  slug: string;
  [key: string]: any;
}

/**
 * Creates a Jekyll collection, with the data embedded into the front matter.
 */
const JekyllCreateCollection: NodeObject = {
  in: {
    data: {
      required: true,
    },
    defaults: {
      defaultValue: {},
    },
    limit: {},
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
    let data = context.readFromPort<object[]>('data');
    const numItems = data.length;
    const defaults = context.readFromPort<object>('defaults');
    const limit = context.readFromPort<Limit>('limit');
    const meta = context.readFromPort<CollectionMetaData>('meta');
    const slugKey = context.readFromPort<string>('slugKey');
    if (limit !== undefined) {
      data = _.orderBy(data, limit.orderBy, limit.orders).slice(0, limit.count);
    }
    context.writeToPort<CollectionData>('collection', {
      items: data.map((item, i) => ({
        ...item,
        ...defaults,
        position: i,
        slug: item[slugKey],
      })),
      meta: _.defaults({}, meta, {
        data_size: numItems,
        layout: 'default',
        published: new Date().toDateString(),
      }),
    });
    return `Created collection with ${data.length} items`;
  },
};

export { JekyllCreateCollection };
