import yaml from 'js-yaml';
import _ from 'lodash';
import path from 'path';
import { createPath, removeFiles, writeFile } from '../../../common/fs';
import { NodeObject } from '../../../common/node';

const encodeFrontMatter = (data: object) =>
  `---\n${yaml.safeDump(data, { skipInvalid: true })}---\n`;

export interface Limit {
  count: number;
  orderBy: string[];
  orders?: Array<'asc' | 'desc'>;
}

/**
 * Creates a Jekyll collection, with the data embedded into the front matter.
 */
const CreateJekyllCollection: NodeObject = {
  in: {
    data: {
      required: true,
    },
    defaults: {
      defaultValue: {},
    },
    limit: {},
    path: {
      defaultValue: '.',
    },
    slugKey: {
      required: true,
    },
  },

  async process(context) {
    const collectionRoot = await createPath(
      context.readFromPort<string>('path'),
      context.definitionsPath
    );
    let data = context.readFromPort<object[]>('data');
    const defaults = context.readFromPort<object>('defaults');
    const limit = context.readFromPort<Limit>('limit');
    const slugKey = context.readFromPort<string>('slugKey');
    if (limit !== undefined) {
      data = _.orderBy(data, limit.orderBy, limit.orders).slice(0, limit.count);
    }
    context.debug(`writing ${data.length} items to "${collectionRoot}"`);
    await removeFiles(collectionRoot, fileName => fileName.endsWith('.md'));
    data.forEach((item, i) => {
      const itemData = _.defaults({}, item, defaults, { position: i });
      const slug = _.get(itemData, slugKey) as string;
      writeFile(
        path.resolve(collectionRoot, `${slug}.md`),
        encodeFrontMatter(itemData)
      );
    });
    return `Created collection with ${data.length} items`;
  },
};

export { CreateJekyllCollection };
