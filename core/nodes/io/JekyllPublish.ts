import yaml from 'js-yaml';
import _ from 'lodash';
import path from 'path';
import { NodeObject } from '../../../common/node';
import { checkFile, createPath, readFile, writeFile } from '../../fs';
import { CollectionData } from './JekyllCreateCollection';

const encodeFrontMatter = (data: object) =>
  `---\n${yaml.safeDump(data, { skipInvalid: true, sortKeys: true })}---\n`;

const readFrontMatter = async (filePath: string) =>
  yaml.safeLoad(
    (await readFile(filePath)).match(/---(?<yaml>.*)---\n/ms)!.groups!.yaml
  );

const updateFrontMatter = async (filePath: string, frontMatter: string) =>
  writeFile(
    filePath,
    (await readFile(filePath)).replace(/---.*---\n/ms, frontMatter)
  );

/**
 * Creates a Jekyll collection, with the data embedded into the front matter.
 */
const JekyllPublish: NodeObject = {
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
    const collections = _.castArray(
      context.readFromPort<CollectionData | CollectionData[]>('collections')
    );
    const pageRoot = await createPath(
      context.readFromPort<string>('path'),
      context.definitionsPath
    );
    const collectionsRoot = await createPath(
      path.resolve(pageRoot, 'collections')
    );

    // Write or update templates
    await Promise.all(
      collections.map(async collectionData => {
        const slug = collectionData.meta.id;
        context.debug(`writing template for collection "${slug}"`);
        const templatePath = path.resolve(collectionsRoot, `${slug}.md`);
        if (await checkFile(templatePath)) {
          // Existing templates have their front matter replaced. That way they
          // can contain manual content as well.
          const frontMatterData = _.assign(
            await readFrontMatter(templatePath),
            collectionData.meta,
            { items: collectionData.items.map(x => x.slug) }
          );
          await updateFrontMatter(
            templatePath,
            encodeFrontMatter(frontMatterData)
          );
        } else {
          await writeFile(templatePath, encodeFrontMatter(collectionData.meta));
        }
      })
    );

    // Write details collection
    const allItems = _.uniqBy(
      _.flatten(collections.map(data => data.items)),
      'slug'
    );
    context.debug(`writing details collection with ${allItems.length} items`);
    const collectionRoot = await createPath(
      path.resolve(pageRoot, '_collections', `_details`)
    );
    await Promise.all(
      allItems.map(async item => {
        await writeFile(
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

export { JekyllPublish };
