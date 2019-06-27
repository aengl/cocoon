import { CocoonNode } from '@cocoon/types';
import _ from 'lodash';

export interface Ports {
  data: object[];
  filter?: (data: object) => boolean;
  limit: number;
  meta: CollectionMeta;
  score?: object;
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
    filter: {
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
    score: {
      hide: true,
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
    const { data, filter, limit, meta, score } = context.ports.read();
    if (!meta.id) {
      throw new Error(`collection metadata is missing an "id" field`);
    }
    const numItems = data.length;
    const scoreAttribute = `score_${meta.id}`;

    // Filter
    const filteredData = filter
      ? ((await context.processTemporaryNode('FilterCustom', { data, filter }))
          .data as object[])
      : data;

    // Score
    const scoredData = score
      ? _.sortBy(
          (await context.processTemporaryNode('Score', {
            config: {
              [scoreAttribute]: score,
            },
            data: filteredData,
          })).data as object[],
          scoreAttribute
        )
      : filteredData;

    // Create collection
    const items = scoredData.slice(0, limit);
    const collection = {
      items,
      meta: _.defaults({}, meta, {
        data_size: filteredData.length,
        last_modified_at: new Date().toDateString(),
      }),
    };
    context.ports.write({ collection });
    return `Created collection with ${items.length} items from a pool of ${filteredData.length} items`;
  },
};
