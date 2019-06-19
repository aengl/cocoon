import { CocoonNode } from '@cocoon/types';
import _ from 'lodash';

export interface Ports {
  data: object[];
  defaults: object;
  limit: number;
  meta: CollectionMeta;
}

export interface CollectionData {
  items: any[];
  meta: CollectionMeta;
}

export interface CollectionMeta {
  layout: string;
  id: string;
  slug: string;
  title: string;
  [key: string]: any;
}

export const CreateCollection: CocoonNode<Ports> = {
  category: 'I/O',
  description: `Creates a data collection for publishing. Used in combination with "PublishCollections".`,

  in: {
    data: {
      required: true,
    },
    defaults: {
      defaultValue: {},
      hide: true,
    },
    limit: {
      defaultValue: 20,
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
    const slicedData = data.slice(0, limit);
    const collection = {
      items: slicedData.map((item, i) => ({
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
    return `Created collection with ${slicedData.length} items`;
  },
};
