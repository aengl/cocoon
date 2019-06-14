import { CocoonNode, CocoonNodeContext } from '@cocoon/types';
import matter from 'gray-matter';
import _ from 'lodash';
import path from 'path';
import { CollectionData } from './CreateCollection';
import { ItemWithSlug } from './Slugify';

export interface Ports {
  attributes: string[];
  collections: CollectionData | CollectionData[];
  collectionsPath: string;
  data: ItemWithSlug[];
  details: string[];
  detailsPath: string;
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
    details: {
      defaultValue: [],
      description:
        'A list of additional slugs to publish as detail documents only.',
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
    const { debug, fs } = context;
    const ports = context.ports.read();
    const { data, details } = ports;
    const detailsPath = await fs.createPath(ports.detailsPath, {
      root: context.definitions.root,
    });

    // Create collections
    const collections = await writeCollectionDocuments(ports, context);

    // Map data by slugs
    const dataBySlug = data.reduce((all, item, i) => {
      all[item.slug] = item;
      return all;
    }, {});

    // Collect all existing collection items (so the ones that were removed from
    // collections can be updated as well)
    //
    // TODO: remove type and fix fs type in @cocoon/types
    const documentPaths: string[] = await fs.resolveDirectoryContents(
      detailsPath
    );
    const detailPageItemsBySlug: {
      [slug: string]: object;
    } = (await Promise.all(
      documentPaths.map(async itemPath => ({
        ...(await readDocument(fs, itemPath)),
        path: itemPath,
      }))
    )).reduce((all, item) => {
      if (item.data.slug) {
        all[item.data.slug] = item.data;
      }
      return all;
    }, {});

    // Update pages with new data
    data.forEach((item, i) => {
      if (item.slug in detailPageItemsBySlug) {
        detailPageItemsBySlug[item.slug] = item;
      }
    });

    // Add collection items that are currently listed
    collections
      .flatMap(c => c.items)
      .reduce((all, item) => {
        all[item.slug] = item;
        return all;
      }, detailPageItemsBySlug);

    // Add collection items that were specifically requested
    details.reduce((all, slug) => {
      if (slug in dataBySlug) {
        all[slug] = dataBySlug[slug];
      } else {
        debug(`warning: slug "${slug}" not found in data`);
      }
      return all;
    }, detailPageItemsBySlug);

    // Write detail documents
    const allItemSlugs = Object.keys(detailPageItemsBySlug);
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
            ...detailPageItemsBySlug[slug],
          },
          ports.attributes
        )
      )
    );

    // Get original data for published items, annotated with the slug and the
    // collections it was published in
    const publishedData = published.map((pub: any) => ({
      slug: pub.slug,
      collections: collections
        .map(collection => ({
          position: collection.items.findIndex(item => item.slug === pub.slug),
          meta: collection.meta,
        }))
        .filter(collection => collection.position >= 0),
      ...(dataBySlug[pub.slug] || detailPageItemsBySlug[pub.slug]),
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
  const collections = _.castArray(ports.collections);
  const collectionsPath = await fs.createPath(ports.collectionsPath, {
    root: context.definitions.root,
  });

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