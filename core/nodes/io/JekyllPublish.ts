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
import { ListData, ListItem } from './JekyllCreateCollection';

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
    details: {
      defaultValue: true,
    },
    lists: {
      required: true,
    },
    path: {
      defaultValue: '.',
    },
  },

  out: {
    published: {},
  },

  async process(context) {
    const lists = _.castArray(
      context.readFromPort<ListData | ListData[]>('lists')
    );
    const pageRoot = await createPath(
      context.readFromPort<string>('path'),
      context.definitionsPath
    );
    const generateDetailPages = context.readFromPort<boolean>('details');
    const listRoot = await createPath(path.resolve(pageRoot, 'lists'));
    const publishedData: ListItem[] = [];
    await Promise.all(
      lists.map(async listData => {
        const slug = listData.meta.list;

        // Write collection
        context.debug(
          `writing ${listData.items.length} items for collection "${slug}"`
        );
        const collectionRoot = await createPath(
          path.resolve(pageRoot, '_collections', `_${listData.meta.list}`)
        );
        await removeFiles(collectionRoot, fileName => fileName.endsWith('.md'));
        await Promise.all(
          listData.items.map(async item => {
            await writeFile(
              path.resolve(collectionRoot, `${item.slug}.md`),
              encodeFrontMatter(item)
            );
            publishedData.push(item);
          })
        );

        // Write or update template
        context.debug(`writing template for collection "${slug}"`);
        const templatePath = path.resolve(listRoot, `${slug}.md`);
        if (await checkFile(templatePath)) {
          // Existing templates have their front matter replaced. That way they
          // can contain manual content as well.
          const frontMatterData = _.assign(
            await readFrontMatter(templatePath),
            listData.meta
          );
          await updateFrontMatter(
            templatePath,
            encodeFrontMatter(frontMatterData)
          );
        } else {
          await writeFile(
            templatePath,
            `${encodeFrontMatter(
              listData.meta
            )}\n{% include list-default.md %}\n`
          );
        }
      })
    );

    // Update site config
    const configPath = path.resolve(pageRoot, '_config.yml');
    const config = await parseYamlFile(configPath);
    _.set(
      config,
      'collections',
      lists.reduce(
        (all, listData) =>
          _.assign(all, {
            [listData.meta.list]: generateDetailPages
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

    return `Published page with ${lists.length} lists at "${pageRoot}"`;
  },
};

export { JekyllPublish };
