import yaml from 'js-yaml';
import _ from 'lodash';
import path from 'path';
import {
  checkFile,
  createPath,
  parseYamlFile,
  readFile,
  removeFiles,
  writeFile,
} from '../../../common/fs';
import { NodeObject } from '../../../common/node';
import { CollectionData, CollectionItem } from './JekyllCreateCollection';

const encodeFrontMatter = (data: object) =>
  `---\n${yaml.safeDump(data, { skipInvalid: true })}---\n`;

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
    details: {
      defaultValue: true,
    },
    path: {
      defaultValue: '.',
    },
    template: {
      defaultValue: false,
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
    const generateDetailPages = context.readFromPort<boolean>('details');
    const collectionsRoot = await createPath(
      path.resolve(pageRoot, 'collections')
    );
    const template = context.readFromPort<string | boolean>('template');
    const publishedData: CollectionItem[] = [];
    await Promise.all(
      collections.map(async collectionData => {
        const slug = collectionData.meta.id;

        // Write collection
        context.debug(
          `writing ${
            collectionData.items.length
          } items for collection "${slug}"`
        );
        const collectionRoot = await createPath(
          path.resolve(pageRoot, '_collections', `_${collectionData.meta.id}`)
        );
        await removeFiles(collectionRoot, fileName => fileName.endsWith('.md'));
        await Promise.all(
          collectionData.items.map(async item => {
            await writeFile(
              path.resolve(collectionRoot, `${item.slug}.md`),
              encodeFrontMatter(item)
            );
            publishedData.push(item);
          })
        );

        // Write or update template
        if (template !== false) {
          context.debug(`writing template for collection "${slug}"`);
          const templatePath = path.resolve(collectionsRoot, `${slug}.md`);
          if (await checkFile(templatePath)) {
            // Existing templates have their front matter replaced. That way they
            // can contain manual content as well.
            const frontMatterData = _.assign(
              await readFrontMatter(templatePath),
              collectionData.meta
            );
            await updateFrontMatter(
              templatePath,
              encodeFrontMatter(frontMatterData)
            );
          } else {
            await writeFile(
              templatePath,
              `${encodeFrontMatter(collectionData.meta)}\n${template}\n`
            );
          }
        }
      })
    );

    // Update site config
    const configPath = path.resolve(pageRoot, '_config.yml');
    const config = await parseYamlFile(configPath);
    _.assign(
      config.collections,
      collections.reduce(
        (all, collectionData) =>
          _.assign(all, {
            [collectionData.meta.id]: generateDetailPages
              ? {
                  output: true,
                  permalink: '/:title',
                }
              : {
                  output: false,
                },
          }),
        {}
      )
    );
    await writeFile(
      configPath,
      yaml.dump(config, {
        noRefs: true,
      })
    );

    // Write published data
    context.writeToPort('published', _.uniqBy(publishedData, 'slug'));

    return `Published page with ${
      collections.length
    } collections at "${pageRoot}"`;
  },
};

export { JekyllPublish };
