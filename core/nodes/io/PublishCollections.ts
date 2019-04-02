import matter from 'gray-matter';
import _ from 'lodash';
import path from 'path';
import { slugify } from '../../../common/nlp';
import { NodeContext, NodeObject } from '../../../common/node';
import { CollectionData } from '../data/CreateCollection';

interface CollectionItem {
  slug: string;
  [key: string]: any;
}

/**
 * Publishes a list of collections as markdown files with a frontmatter.
 *
 * It will create a document for each collection, as well as a document for each
 * unique item across all collections.
 *
 * If data is supplied, it will be used to update the data in existing documents
 * in the details path.
 */
export const PublishCollections: NodeObject = {
  category: 'I/O',

  in: {
    attributes: {
      hide: true,
    },
    collections: {
      required: true,
    },
    collectionsPath: {
      defaultValue: 'collections',
      hide: true,
    },
    data: {},
    detailsPath: {
      defaultValue: 'details',
      hide: true,
    },
    slug: {
      required: true,
    },
  },

  out: {
    published: {},
  },

  defaultPort: {
    incoming: false,
    name: 'published',
  },

  async process(context) {
    const { fs } = context;
    const attributes = context.ports.read<string[]>('attributes');
    const collectionsPath = await fs.createPath(
      context.ports.read<string>('collectionsPath'),
      { root: context.definitions.root }
    );
    const data = context.ports.read<any[]>('data');
    const detailsPath = await fs.createPath(
      context.ports.read<string>('detailsPath'),
      { root: context.definitions.root }
    );
    const slugKey = context.ports.read<string>('slug');

    // Copy trimmed collections and assign slugs to collection items
    const collections = _.castArray(
      context.ports.read<CollectionData | CollectionData[]>('collections')
    ).map(collection => ({
      items: collection.items.map(item => ({
        slug: slugify(item[slugKey]),
        ...pruneObject(item, attributes),
      })) as CollectionItem[],
      meta: collection.meta,
    }));

    // Write or update collection items
    await Promise.all(
      collections.map(collectionData => {
        const id = collectionData.meta.id;
        const itemPath = path.resolve(collectionsPath, `${id}.md`);
        context.debug(
          `writing document for collection "${id}" to "${itemPath}"`
        );
        return writeDocument(fs, itemPath, {
          ...collectionData.meta,
          items: collectionData.items.map(x => x.slug),
        });
      })
    );

    // Collect all existing collection items (so the ones that were removed from
    // collections can be updated as well)
    const allItemsDict = {};
    if (data) {
      const documentPaths = await fs.resolveDirectoryContents(detailsPath);
      (await Promise.all(
        documentPaths.map(async itemPath => ({
          ...(await readDocument(fs, itemPath)),
          path: itemPath,
        }))
      )).reduce((all, item) => {
        if (item.data.slug) {
          all[item.data.slug] = item;
        }
        return all;
      }, allItemsDict);

      // Update pages with new data
      data.forEach(item => {
        const slug = slugify(item[slugKey]);
        const document = allItemsDict[slug];
        if (document) {
          allItemsDict[slug] = item;
        }
      });
    }

    // Add collection items that are currently listed
    collections
      .flatMap(c => c.items)
      .reduce((all, item) => {
        all[item.slug] = item;
        return all;
      }, allItemsDict);

    // Write documents for collection items
    const allItemSlugs = Object.keys(allItemsDict);
    context.debug(
      `writing details documents for ${
        allItemSlugs.length
      } items to "${detailsPath}"`
    );
    const published = await Promise.all(
      allItemSlugs.map(async slug =>
        writeDocument(
          fs,
          path.resolve(detailsPath, `${slug}.md`),
          {
            slug,
            ...allItemsDict[slug],
          },
          attributes
        )
      )
    );

    // Write published data
    context.ports.writeAll({ published });

    return `Published ${collections.length} collections with ${
      published.length
    } items`;
  },
};

async function readDocument(fs: NodeContext['fs'], documentPath: string) {
  return matter(await fs.readFile(documentPath));
}

async function writeDocument(
  fs: NodeContext['fs'],
  documentPath: string,
  data: object,
  attributes?: string[]
) {
  const options: any = {
    sortKeys: true,
  };
  if (await fs.checkPath(documentPath)) {
    // Existing templates have their front matter updated. That way they
    // can contain manual content as well.
    const parsed = matter(await fs.readFile(documentPath));
    const prunedData = pruneObject(_.assign(parsed.data, data), attributes);
    await fs.writeFile(
      documentPath,
      matter.stringify('\n' + parsed.content.trim(), prunedData, options)
    );
    return prunedData;
  } else {
    const prunedData = pruneObject(data, attributes);
    await fs.writeFile(documentPath, matter.stringify('', prunedData, options));
    return prunedData;
  }
}

function pruneObject(obj: object, attributes?: string[]) {
  return attributes ? _.pick(obj, attributes) : obj;
}
