import yaml from 'js-yaml';
import _ from 'lodash';
import path from 'path';
import { createPath, removeFiles, writeFile } from '../../../common/fs';
import { NodeObject } from '../../../common/node';

const encodeFrontMatter = (data: object) =>
  `---\n${yaml.safeDump(data, { skipInvalid: true })}---\n`;

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
    const data = context.readFromPort<object[]>('data');
    const defaults = context.readFromPort<object>('defaults');
    const limit = context.readFromPort<number>('limit');
    const slugKey = context.readFromPort<string>('slugKey');
    const limitedData = limit === undefined ? data : data.slice(0, limit);
    context.debug(`writing ${data.length} items to "${collectionRoot}"`);
    await removeFiles(collectionRoot, fileName => fileName.endsWith('.md'));
    limitedData.forEach(item => {
      const itemData = _.defaults({}, item, defaults);
      const slug = _.get(itemData, slugKey) as string;
      writeFile(
        path.resolve(collectionRoot, `${slug}.md`),
        encodeFrontMatter(itemData)
      );
    });
  },
};

export { CreateJekyllCollection };
