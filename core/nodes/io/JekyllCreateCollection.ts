import _ from 'lodash';
import { NodeObject } from '../../../common/node';

export interface Limit {
  count: number;
  orderBy: string[];
  orders?: Array<'asc' | 'desc'>;
}

export interface ListData {
  items: ListItem[];
  meta: ListMetaData;
}

export interface ListMetaData {
  layout: string;
  list: string;
  permalink: string;
  title: string;
  [key: string]: any;
}

export interface ListItem {
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
    list: {},
  },

  async process(context) {
    let data = context.readFromPort<object[]>('data');
    const defaults = context.readFromPort<object>('defaults');
    const limit = context.readFromPort<Limit>('limit');
    const meta = context.readFromPort<ListMetaData>('meta');
    const slugKey = context.readFromPort<string>('slugKey');
    if (limit !== undefined) {
      data = _.orderBy(data, limit.orderBy, limit.orders).slice(0, limit.count);
    }
    context.writeToPort<ListData>('list', {
      items: data.map((item, i) => ({
        ...item,
        ...defaults,
        position: i,
        slug: item[slugKey],
      })),
      meta: _.defaults({}, meta, {
        layout: 'default',
        published: new Date().toISOString(),
      }),
    });
    return `Created collection with ${data.length} items`;
  },
};

export { JekyllCreateCollection };
