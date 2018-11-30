import _ from 'lodash';
import { NodeObject } from '../../../common/node';

export interface Limit {
  count: number;
  orderBy: string[];
  orders?: Array<'asc' | 'desc'>;
}

export interface ListData extends ListMetaData {
  items: ListItem[];
}

export interface ListMetaData {
  title: string;
  slug: string;
  permalink: string;
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
    list: {
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
    const list = context.readFromPort<ListMetaData>('list');
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
      permalink: list.permalink,
      slug: list.slug,
      title: list.title,
    });
    return `Created collection with ${data.length} items`;
  },
};

export { JekyllCreateCollection };
