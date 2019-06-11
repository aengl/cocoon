import { CocoonNode, CocoonNodeContext } from '@cocoon/types';
import slugify from '@sindresorhus/slugify';
import matter from 'gray-matter';
import _ from 'lodash';
import path from 'path';
import { CollectionData } from './CreateCollection';

const slugifyOptions: slugify.Options = {
  customReplacements: [['&', ' and '], [`'`, ''], [`’`, ''], ['.', '']],
};

interface CollectionItem {
  slug: string;
  [key: string]: any;
}

export interface Ports {
  attributes: string[];
  collections: CollectionData | CollectionData[];
  collectionsPath: string;
  data: object[];
  detailsPath: string;
  slug: string;
}

export const PublishCollections: CocoonNode<Ports> = {
  category: 'I/O',
  description: `Publishes a list of collections as markdown files with a frontmatter.

It will create a document for each collection, as well as a document for each unique item across all collections.

Existing documents in the details path will be updated with the new data.`,

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
    data: {
      required: true,
    },
    detailsPath: {
      defaultValue: 'details',
      hide: true,
    },
    slug: {
      required: true,
    },
  },

  out: {
    data: {},
    published: {},
  },

  defaultPort: {
    incoming: false,
    name: 'published',
  },

  async process(context) {
    const { fs } = context;
    const ports = context.ports.read();
    const { data } = ports;
    const detailsPath = await fs.createPath(ports.detailsPath, {
      root: context.definitions.root,
    });

    // Create collections
    const collections = await writeCollectionDocuments(ports, context);

    // Collect all existing collection items (so the ones that were removed from
    // collections can be updated as well)
    const collectionItemsBySlug: { [slug: string]: object } = {};
    const documentPaths = await fs.resolveDirectoryContents(detailsPath);
    (await Promise.all(
      documentPaths.map(async itemPath => ({
        ...(await readDocument(fs, itemPath)),
        path: itemPath,
      }))
    )).reduce<typeof collectionItemsBySlug>((all, item: any) => {
      // TODO: remove item type and fix fs type in @cocoon/types
      if (item.data.slug) {
        all[item.data.slug] = item;
      }
      return all;
    }, collectionItemsBySlug);

    // Update pages with new data
    const slugs = data.map(item => slugify(item[ports.slug], slugifyOptions));
    data.forEach((item, i) => {
      const slug = slugs[i];
      if (slug in collectionItemsBySlug) {
        collectionItemsBySlug[slug] = item;
      }
    });

    // Add collection items that are currently listed
    collections
      .flatMap(c => c.items)
      .reduce((all, item) => {
        all[item.slug] = item;
        return all;
      }, collectionItemsBySlug);

    // Write documents for collection items
    const allItemSlugs = Object.keys(collectionItemsBySlug);
    context.debug(
      `writing details documents for ${allItemSlugs.length} items to "${detailsPath}"`
    );
    const published = await Promise.all(
      allItemSlugs.map(async slug =>
        writeDocument(
          fs,
          path.resolve(detailsPath, `${slug}.md`),
          {
            slug,
            ...collectionItemsBySlug[slug],
          },
          ports.attributes
        )
      )
    );

    // Get original data for published items, annotated with the slug and the
    // collections it was published in
    const dataBySlug = data.reduce((all, item, i) => {
      all[slugs[i]] = item;
      return all;
    }, {});
    const publishedData = published.map((pub: any) => ({
      slug: pub.slug,
      collections: collections
        .map(collection => ({
          position: collection.items.findIndex(item => item.slug === pub.slug),
          meta: collection.meta,
        }))
        .filter(collection => collection.position >= 0),
      ...dataBySlug[pub.slug],
    }));

    // Write published data
    context.ports.write({
      data: publishedData,
      published,
    });

    return `Published ${collections.length} collections with ${published.length} items`;
  },
};

async function readDocument(fs: CocoonNodeContext['fs'], documentPath: string) {
  return matter(await fs.readFile(documentPath));
}

function pruneObject(obj: object, attributes?: string[]) {
  return attributes ? _.pick(obj, attributes) : obj;
}

async function writeDocument(
  fs: CocoonNodeContext['fs'],
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

async function writeCollectionDocuments(
  ports: Ports,
  context: CocoonNodeContext<Ports>
) {
  const { fs } = context;
  const collectionsPath = await fs.createPath(ports.collectionsPath, {
    root: context.definitions.root,
  });

  // Copy collections and assign slugs to collection items
  const collections = _.castArray(ports.collections).map(collection => ({
    items: collection.items.map(
      (item): CollectionItem => ({
        slug: slugify(item[ports.slug], slugifyOptions),
        ...item,
      })
    ),
    meta: collection.meta,
  }));

  // Write or update collection items
  await Promise.all(
    collections.map(collectionData => {
      const id = collectionData.meta.id;
      const itemPath = path.resolve(collectionsPath, `${id}.md`);
      context.debug(`writing document for collection "${id}" to "${itemPath}"`);
      return writeDocument(context.fs, itemPath, {
        ...collectionData.meta,
        items: collectionData.items.map(x => x.slug),
      });
    })
  );

  return collections;
}
