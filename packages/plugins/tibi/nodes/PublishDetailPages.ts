import { CocoonNode } from '@cocoon/types';
import fs from 'fs';
import matter from 'gray-matter';
import { DumpOptions } from 'js-yaml';
import _ from 'lodash';
import { ItemWithSlug } from './Slugify';

export interface Ports {
  attributes: string[];
  data: ItemWithSlug[];
}

export const PublishDetailPages: CocoonNode<Ports> = {
  category: 'I/O',
  description: `Publishes detail pages as markdown files with a frontmatter. Creates a document for each unique data item. Existing documents in the details path will be updated with the new data.`,

  in: {
    attributes: {
      description: `The list of attributes that will be written into detail documents. If omitted, all data attributes will be written.`,
      hide: true,
    },
    data: {
      description: `Data for the items to be published`,
      required: true,
    },
  },

  out: {
    data: {
      description: `Original data of documents that were published, with the addition of documents that were published bu no longer have associated data (orphans). Data items will additionally contain a list of collections they were published to in the "collection" attribute.`,
    },
  },

  defaultPort: {
    incoming: false,
    name: 'published',
  },

  async *process(context) {
    const ports = context.ports.read();
    const { data } = ports;

    // Write detail documents
    context.debug(`writing details documents`);
    const options: DumpOptions = {
      skipInvalid: true,
      sortKeys: true,
    };
    await Promise.all(
      data.map(async item => {
        fs.promises.writeFile(
          item.$path,
          matter.stringify(
            '',
            _.pickBy(
              ports.attributes ? _.pick(item, ports.attributes) : item,
              x => !_.isNil(x)
            ),
            options as any
          )
        );
      })
    );

    // Write published data
    context.ports.write({ data });

    return `Published ${data.length} detail pages`;
  },
};
