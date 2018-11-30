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
  writeYamlFile,
} from '../../../common/fs';
import { NodeObject } from '../../../common/node';
import { ListData } from './JekyllCreateCollection';

const encodeFrontMatter = (data: object) =>
  `---\n${yaml.safeDump(data, { skipInvalid: true })}---\n`;

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
    lists: {
      required: true,
    },
    path: {
      required: true,
    },
  },

  async process(context) {
    const lists = _.castArray(
      context.readFromPort<ListData | ListData[]>('lists')
    );
    const pageRoot = await createPath(
      context.readFromPort<string>('path'),
      context.definitionsPath
    );
    const listRoot = await createPath(path.resolve(pageRoot, 'lists'));
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
          listData.items.map(item => {
            writeFile(
              path.resolve(collectionRoot, `${item.slug}.md`),
              encodeFrontMatter(item)
            );
          })
        );

        // Write or update template
        context.debug(`writing template for collection "${slug}"`);
        const templatePath = path.resolve(listRoot, `${slug}.md`);
        const frontMatter = encodeFrontMatter(listData.meta);
        if (await checkFile(templatePath)) {
          // Existing templates have their front matter replaced. That way they
          // can contain manual content as well.
          await updateFrontMatter(templatePath, frontMatter);
        } else {
          await writeFile(
            templatePath,
            `${frontMatter}\n{% include list.md %}`
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
            [listData.meta.list]: {
              output: true,
              permalink: '/:title',
            },
          }),
        {}
      )
    );
    await writeYamlFile(configPath, config);

    return `Published page with ${lists.length} lists at "${pageRoot}"`;
  },
};

export { JekyllPublish };
