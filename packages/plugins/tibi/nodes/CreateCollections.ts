import { CocoonNode, CocoonNodeContext } from '@cocoon/types';
import _ from 'lodash';

export interface CollectionConfig {
  excludes?: string[];
  filter?: (data: object) => boolean;
  includes?: string[];
  limit?: number | boolean;
  score?: object;
}

export interface Ports {
  data: Array<{ slug: string }>;
  collections: {
    [slug: string]: CollectionConfig;
  };
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

export const CreateCollections: CocoonNode<Ports> = {
  category: 'I/O',
  description: `Creates a data collection for publishing. Used in combination with "PublishCollections".`,

  in: {
    collections: {
      hide: true,
      required: true,
    },
    data: {
      required: true,
    },
  },

  out: {
    collections: {},
    data: {},
    stats: {},
  },

  async *process(context) {
    const { collections, data } = context.ports.read();

    const results = await Promise.all(
      Object.keys(collections).map(slug =>
        createCollection(context, data, slug, collections[slug])
      )
    );

    context.ports.write({
      collections: results.map(x => x.collection),
      data: results.map(x => x.scoredData),
      stats: results.map(x => x.stats),
    });
    return `Created ${results.length} collections`;
  },
};

async function createCollection(
  context: CocoonNodeContext,
  data: Ports['data'],
  slug: string,
  config: CollectionConfig
) {
  const { excludes, filter, includes, limit, score } = config;
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
      : scoredData.slice(0, limit === true || limit === undefined ? 20 : limit);
  const collection = {
    items,
    meta: {
      data_size: filteredData.length,
      last_modified_at: new Date().toDateString(),
      layout: 'collection',
      slug,
    },
  };

  return { collection, scoredData, stats };
}
