import matter from 'gray-matter';
import _ from 'lodash';
import path from 'path';
import { NodeContext, NodeObject } from '../../../common/node';
import { CollectionData } from '../data/CreateCollection';

/**
 * Publishes a list of collections as markdown files with a frontmatter.
 *
 * It will create a document for each collection, as well as a document for each
 * unique item across all collections.
 */
export const PublishCollections: NodeObject = {
  category: 'I/O',

  in: {
    collections: {
      required: true,
    },
    collectionsPath: {
      defaultValue: 'collections',
    },
    details: {
      required: true,
    },
    detailsPath: {
      defaultValue: 'details',
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
    const collections = _.castArray(
      context.ports.read<CollectionData | CollectionData[]>('collections')
    );
    const collectionsPath = await fs.createPath(
      context.ports.read<string>('collectionsPath'),
      { root: context.definitions.root }
    );
    const detailsPath = await fs.createPath(
      context.ports.read<string>('detailsPath'),
      { root: context.definitions.root }
    );

    // Write or update collection documents
    await Promise.all(
      collections.map(collectionData => {
        const slug = collectionData.meta.id;
        const documentPath = path.resolve(collectionsPath, `${slug}.md`);
        context.debug(
          `writing document for collection "${slug}" to "${documentPath}"`
        );
        return writeDocument(fs, documentPath, {
          ...collectionData.meta,
          items: collectionData.items.map(x => x.slug),
        });
      })
    );

    // Write details documents
    const allItems = _.uniqBy(
      _.flatten(collections.map(data => data.items)),
      'slug'
    );
    context.debug(
      `writing details documents for ${
        allItems.length
      } items to "${detailsPath}"`
    );
    await Promise.all(
      allItems.map(async item => {
        writeDocument(fs, path.resolve(detailsPath, `${item.slug}.md`), item);
      })
    );

    // Write published data
    context.ports.writeAll({ published: allItems });

    return `Published ${collections.length} collections with ${
      allItems.length
    } items`;
  },
};

async function writeDocument(
  fs: NodeContext['fs'],
  documentPath: string,
  data: object
) {
  if (await fs.checkPath(documentPath)) {
    // Existing templates have their front matter updated. That way they
    // can contain manual content as well.
    const parsed = matter(await fs.readFile(documentPath));
    await fs.writeFile(
      documentPath,
      matter.stringify(parsed.content, _.assign(parsed.data, data))
    );
  } else {
    await fs.writeFile(documentPath, matter.stringify('', data));
  }
}
