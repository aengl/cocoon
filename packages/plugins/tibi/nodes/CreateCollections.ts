import { CocoonNode, PortData } from '@cocoon/types';
import processTemporaryNode from '@cocoon/util/processTemporaryNode';
import _ from 'lodash';

export interface CollectionConfig {
  exclude?: string[];
  filter?: (data: object) => boolean;
  include?: string[];
  items?: string[];
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
    const { collections, data: inputData } = context.ports.read();

    const results: Array<{ collection: any; stats: any }> = [];
    for (const slug of Object.keys(collections)) {
      yield `Creating collection ${slug}`;
      const config = collections[slug];

      const { exclude, filter, include, items, limit, score } = config;
      const scoreAttribute = `score_${slug}`;

      // Filter
      const filterResults: PortData = {};
      if (filter) {
        for await (const progress of processTemporaryNode(
          context,
          'Filter',
          { data: inputData, filter },
          filterResults
        )) {
          yield;
        }
      }
      let data = (filterResults.data as Ports['data']) || inputData;

      // Hardcoded lists
      data = items ? includeSlugs(data, items) : data;

      // Included/filtered data without excludes
      data = excludeSlugs(data, exclude);

      // Score
      let stats = null;
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
            data,
          },
          scoreResults
        )) {
          yield;
        }
        data = _.orderBy(
          scoreResults.data as Ports['data'],
          scoreAttribute,
          'desc'
        );
        stats = scoreResults.stats;
      }
      const numScored = data.length;

      // Create collection
      if (limit !== false && (items === undefined || limit !== undefined)) {
        data = data.slice(
          0,
          limit === true || limit === undefined ? 20 : limit
        );
      }

      // Make sure items in `include` are included
      data =
        include === undefined
          ? data
          : [
              ...data,
              ...excludeSlugs(
                includeSlugs(inputData, include),
                data.map(x => x.slug)
              ),
            ];

      const collection = {
        items: data,
        meta: {
          data_size: numScored,
          last_modified_at: new Date().toDateString(),
          layout: 'collection',
          slug,
        },
      };

      results.push({ collection, stats });
    }

    context.ports.write({
      collections: results.map(x => x.collection),
      data: inputData,
      stats: results.map(x => x.stats),
    });
    return `Created ${results.length} collections`;
  },
};

function includeSlugs(data: Ports['data'], slugs?: string[]) {
  if (slugs === undefined) {
    return [];
  }
  const slugSet = new Set(slugs);
  return data.filter(x => slugSet.has(x.slug));
}

function excludeSlugs(data: Ports['data'], slugs?: string[]) {
  if (slugs === undefined) {
    return data;
  }
  const slugSet = new Set(slugs);
  return data.filter(x => !slugSet.has(x.slug));
}
