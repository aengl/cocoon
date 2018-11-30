import yaml from 'js-yaml';
import _ from 'lodash';
import path from 'path';
import {
  checkFile,
  createPath,
  readFile,
  removeFiles,
  writeFile,
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
        createListItems(pageRoot, listData);
        context.debug(`writing template for collection "${slug}"`);

        // Write or update template
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
    return `Published page with ${lists.length} lists at "${pageRoot}"`;
  },
};

export { JekyllPublish };

async function createListItems(root: string, listData: ListData) {
  const collectionRoot = await createPath(
    path.resolve(root, '_collections', `_${listData.meta.list}`)
  );
  await removeFiles(collectionRoot, fileName => fileName.endsWith('.md'));
  listData.items.forEach(item => {
    writeFile(
      path.resolve(collectionRoot, `${item.slug}.md`),
      encodeFrontMatter(item)
    );
  });
  return listData.items;
}
