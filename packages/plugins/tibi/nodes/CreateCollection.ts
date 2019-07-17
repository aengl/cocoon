import { CocoonNode } from '@cocoon/types';
import _ from 'lodash';

export interface Ports {
  data: Array<{ slug: string }>;
  excludes?: string[];
  filter?: (data: object) => boolean;
  includes?: string[];
  limit: number | boolean;
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
    excludes: {
      description: `A list of banned slugs that will be filtered from the list.`,
      hide: true,
    },
    filter: {
      hide: true,
    },
    includes: {
      description: `If defined, the list will be comprised of the items references by this list of slugs. Ignores configuration for "excludes" and "filter".`,
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

  async *process(context) {
    const {
      data,
      includes,
      filter,
      excludes,
      limit,
      score,
      slug,
    } = context.ports.read();
    const scoreAttribute = `score_${context.graphNode.id}`;

    // Filter
    const includeSet = new Set(includes || []);
    const excludeSet = new Set(excludes || []);
    const filteredData = includes
      ? data.filter(x => includeSet.has(x.slug))
      : (filter
          ? ((await context.processTemporaryNode('Filter', { data, filter }))
              .data as Ports['data'])
          : data
        ).filter(x => !excludeSet.has(x.slug));

    // Score
    let stats = null;
    let scoredData: object[] = filteredData;
    if (score) {
      const result = await context.processTemporaryNode('Score', {
        attributes: {
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
    const items =
      limit === false
        ? scoredData
        : scoredData.slice(
            0,
            limit === true ? CreateCollection.in.limit.defaultValue : limit
          );
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
