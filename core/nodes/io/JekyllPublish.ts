import yaml from 'js-yaml';
import _ from 'lodash';
import path from 'path';
import { NodeContext, NodeObject } from '../../../common/node';
import { CollectionData } from './JekyllCreateCollection';

const encodeFrontMatter = (data: object) =>
  `---\n${yaml.safeDump(data, { skipInvalid: true, sortKeys: true })}---\n`;

const readFrontMatter = async (fs: NodeContext['fs'], filePath: string) =>
  yaml.safeLoad(
    (await fs.readFile(filePath)).match(/---(?<yaml>.*)---\n/ms)!.groups!.yaml
  );

const updateFrontMatter = async (
  fs: NodeContext['fs'],
  filePath: string,
  frontMatter: string
) =>
  fs.writeFile(
    filePath,
    (await fs.readFile(filePath)).replace(/---.*---\n/ms, frontMatter)
  );

/**
 * Creates a Jekyll collection, with the data embedded into the front matter.
 */
export const JekyllPublish: NodeObject = {
  category: 'I/O',

  in: {
    collections: {
      required: true,
    },
    path: {
      defaultValue: '.',
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
      context.readFromPort<CollectionData | CollectionData[]>('collections')
    );
    const pageRoot = await fs.createPath(
      context.readFromPort<string>('path'),
      context.definitionsRoot
    );
    const collectionsRoot = await fs.createPath(
      path.resolve(pageRoot, 'collections')
    );

    // Write or update templates
    await Promise.all(
      collections.map(async collectionData => {
        const slug = collectionData.meta.id;
        context.debug(`writing template for collection "${slug}"`);
        const templatePath = path.resolve(collectionsRoot, `${slug}.md`);
        if (await fs.checkFile(templatePath)) {
          // Existing templates have their front matter replaced. That way they
          // can contain manual content as well.
          const frontMatterData = _.assign(
            await readFrontMatter(fs, templatePath),
            collectionData.meta,
            { items: collectionData.items.map(x => x.slug) }
          );
          await updateFrontMatter(
            fs,
            templatePath,
            encodeFrontMatter(frontMatterData)
          );
        } else {
          await fs.writeFile(
            templatePath,
            encodeFrontMatter(collectionData.meta)
          );
        }
      })
    );

    // Write details collection
    const allItems = _.uniqBy(
      _.flatten(collections.map(data => data.items)),
      'slug'
    );
    context.debug(`writing details collection with ${allItems.length} items`);
    const collectionRoot = await fs.createPath(
      path.resolve(pageRoot, '_collections', `_details`)
    );
    await Promise.all(
      allItems.map(async item => {
        await fs.writeFile(
          path.resolve(collectionRoot, `${item.slug}.md`),
          encodeFrontMatter(item)
        );
      })
    );

    // Write published data
    context.writeToPort('published', allItems);

    return `Published page with ${
      collections.length
    } collections at "${pageRoot}"`;
  },
};
