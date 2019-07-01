import { CocoonNode } from '@cocoon/types';
import _ from 'lodash';

export interface Ports {
  data: object[];
  filter?: (data: object) => boolean;
  limit: number;
  score?: object;
  slug: string;
}

export interface CollectionData {
  items: any[];
  meta: CollectionMeta;
}

export interface CollectionMeta {
  layout: string;
  slug: string;
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
    score: {
      hide: true,
    },
    slug: {
      hide: true,
      required: true,
    },
  },

  out: {
    collection: {},
    data: {},
    stats: {},
  },

  async process(context) {
    const { data, filter, limit, score, slug } = context.ports.read();
    const scoreAttribute = `score_${context.graphNode.id}`;

    // Filter
    const filteredData = filter
      ? ((await context.processTemporaryNode('Filter', { data, f: filter }))
          .data as object[])
      : data;

    // Score
    let stats = null;
    let scoredData: object[] = filteredData;
    if (score) {
      const result = await context.processTemporaryNode('Score', {
        config: {
          [scoreAttribute]: {
            metrics: {
              score: {
                type: 'Equal',
              },
              ...score,
            },
            precision: 3,
          },
        },
        data: filteredData,
      });
      scoredData = _.orderBy(result.data as object[], scoreAttribute, 'desc');
      stats = result.stats;
    }

    // Create collection
    const items = scoredData.slice(0, limit);
    const collection = {
      items,
      meta: {
        data_size: filteredData.length,
        last_modified_at: new Date().toDateString(),
        layout: 'collection',
        slug,
      },
    };
    context.ports.write({
      collection,
      data: scoredData,
      stats,
    });
    return `Created collection with ${items.length} items from a pool of ${filteredData.length} items`;
  },
};
