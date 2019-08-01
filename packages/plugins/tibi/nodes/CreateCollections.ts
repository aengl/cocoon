import { CocoonNode, CocoonNodeContext, PortData } from '@cocoon/types';
import processTemporaryNode from '@cocoon/util/processTemporaryNode';
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
      required: true,
      visible: false,
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

    const results: Array<{ collection: any; stats: any }> = [];
    for (const slug of Object.keys(collections)) {
      yield `Creating collection ${slug}`;
      const config = collections[slug];

      const { excludes, filter, includes, limit, score } = config;
      const scoreAttribute = `score_${slug}`;

      // Filter
      const filterResults: PortData = {};
      if (filter) {
        for await (const progress of processTemporaryNode(
          context,
          'Filter',
          { data, filter },
          filterResults
        )) {
          yield progress;
        }
      }
      const filteredData = (filterResults.data as Ports['data']) || data;

      // Included data
      const includeSet = new Set(includes || []);
      const includedData = includes
        ? data.filter(x => includeSet.has(x.slug))
        : null;

      // Included/filtered data without excludes
      const excludeSet = new Set(excludes || []);
      const dataWithoutExcludes = (includedData || filteredData).filter(
        x => !excludeSet.has(x.slug)
      );

      // Score
      let stats = null;
      let scoredData: object[] = dataWithoutExcludes;
      if (score) {
        const scoreResults: PortData = {};
        for await (const progress of processTemporaryNode(
          context,
          'Score',
          {
            attributes: {
              [scoreAttribute]: {
                metrics: {
                  score: {
                    type: 'Equal',
                  },
                  ...score,
                },
                normalise: true,
                precision: 3,
              },
            },
            data: filteredData,
          },
          scoreResults
        )) {
          yield progress;
        }
        scoredData = _.orderBy(
          scoreResults.data as object[],
          scoreAttribute,
          'desc'
        );
        stats = scoreResults.stats;
      }

      // Create collection
      const items =
        limit === false
          ? scoredData
          : scoredData.slice(
              0,
              limit === true || limit === undefined ? 20 : limit
            );
      const collection = {
        items,
        meta: {
          data_size: scoredData.length,
          last_modified_at: new Date().toDateString(),
          layout: 'collection',
          slug,
        },
      };

      results.push({ collection, stats });
    }

    context.ports.write({
      collections: results.map(x => x.collection),
      data,
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
) {}
