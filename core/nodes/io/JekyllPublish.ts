import yaml from 'js-yaml';
import _ from 'lodash';
import path from 'path';
import { createPath, removeFiles, writeFile } from '../../../common/fs';
import { NodeObject } from '../../../common/node';
import { ListData } from './JekyllCreateCollection';

const encodeFrontMatter = (data: object) =>
  `---\n${yaml.safeDump(data, { skipInvalid: true })}---\n`;

const encodeListTemplate = (data: ListData) => `---
layout: default
list: ${data.slug}
title: ${data.title}
permalink: ${data.permalink}
---

{% include list.md %}
`;

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
      lists.map(async list => {
        context.debug(
          `writing ${list.items.length} items for collection "${list.slug}"`
        );
        createListItems(pageRoot, list);
        context.debug(`writing template for collection "${list.slug}"`);
        await writeFile(
          path.resolve(listRoot, `${list.slug}.md`),
          encodeListTemplate(list)
        );
      })
    );
    return `Published page with ${lists.length} lists at "${pageRoot}"`;
  },
};

export { JekyllPublish };

async function createListItems(root: string, list: ListData) {
  const collectionRoot = await createPath(
    path.resolve(root, '_collections', `_${list.slug}`)
  );
  await removeFiles(collectionRoot, fileName => fileName.endsWith('.md'));
  list.items.forEach(item => {
    writeFile(
      path.resolve(collectionRoot, `${item.slug}.md`),
      encodeFrontMatter(item)
    );
  });
  return list.items;
}
