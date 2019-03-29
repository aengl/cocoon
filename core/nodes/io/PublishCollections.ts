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
    pruneDetails: {
      defaultValue: false,
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
    const pruneDetails = context.ports.read<boolean>('pruneDetails');
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

    // Write or update collection documents
    await Promise.all(
      collections.map(collectionData => {
        const id = collectionData.meta.id;
        const documentPath = path.resolve(collectionsPath, `${id}.md`);
        context.debug(
          `writing document for collection "${id}" to "${documentPath}"`
        );
        return writeDocument(fs, documentPath, {
          ...collectionData.meta,
          items: collectionData.items.map(x => x.slug),
        });
      })
    );

    // Update existing detail documents
    if (data) {
      const documentPaths = await fs.resolveDirectoryContents(detailsPath);
      const documents = (await Promise.all(
        documentPaths.map(async documentPath => ({
          ...(await readDocument(fs, documentPath)),
          path: documentPath,
        }))
      )).reduce((all, document) => {
        all[document.data[slugKey]] = document;
        return all;
      }, {});
      data.forEach(item => {
        const document = documents[item[slugKey]];
        if (document) {
          writeDocument(
            fs,
            document.path,
            {
              slug: slugify(item[slugKey]),
              ...pruneObject(item, attributes),
            },
            pruneDetails
          );
        }
      });
    }

    // Write details documents
    const allItems = _.uniqBy(collections.flatMap(c => c.items), 'slug');
    context.debug(
      `writing details documents for ${
        allItems.length
      } items to "${detailsPath}"`
    );
    await Promise.all(
      allItems.map(async item => {
        writeDocument(
          fs,
          path.resolve(detailsPath, `${item.slug}.md`),
          item,
          pruneDetails
        );
      })
    );

    // Write published data
    context.ports.writeAll({ published: allItems });

    return `Published ${collections.length} collections with ${
      allItems.length
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
  prune?: boolean
) {
  const options: any = {
    sortKeys: true,
  };
  if (!prune && (await fs.checkPath(documentPath))) {
    // Existing templates have their front matter updated. That way they
    // can contain manual content as well.
    const parsed = matter(await fs.readFile(documentPath));
    await fs.writeFile(
      documentPath,
      matter.stringify(parsed.content, _.assign(parsed.data, data), options)
    );
  } else {
    await fs.writeFile(documentPath, matter.stringify('', data, options));
  }
}

function pruneObject(obj: object, attributes: string[]) {
  return attributes ? _.pick(obj, attributes) : obj;
}
