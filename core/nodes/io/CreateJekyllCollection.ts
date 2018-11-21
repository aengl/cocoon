import yaml from 'js-yaml';
import _ from 'lodash';
import path from 'path';
import { NodeObject } from '..';
import { createPath, writeFile } from '../../fs';

const encodeFrontMatter = (data: object) => `---\n${yaml.safeDump(data)}---\n`;

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
    path: {
      defaultValue: '.',
    },
    slugKey: {
      required: true,
    },
  },

  process: async context => {
    const collectionRoot = await createPath(
      context.readFromPort<string>('path'),
      context.definitionsPath
    );
    const data = context.readFromPort<object[]>('data');
    const defaults = context.readFromPort<object>('defaults');
    const slugKey = context.readFromPort<string>('slugKey');
    data.forEach(item => {
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
