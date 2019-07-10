import { CocoonNode } from '@cocoon/types';
import slugify from '@sindresorhus/slugify';
import _ from 'lodash';

const slugifyOptions: slugify.Options = {
  customReplacements: [['&', ' and '], [`'`, ''], [`’`, ''], ['.', '']],
};

export interface ItemWithSlug {
  slug: string;
  [key: string]: any;
}

export interface Ports {
  attribute: string | string[];
  data: Item[];
}

interface Item {
  slug?: string;
}

export const Slugify: CocoonNode<Ports> = {
  category: 'Data',
  description: `Creates a slug from an attribute, with possible fallbacks.`,

  in: {
    attribute: {
      hide: true,
      required: true,
    },
    data: {
      required: true,
    },
  },

  out: {
    data: {},
  },

  async *process(context) {
    const ports = context.ports.read();
    const { attribute, data } = ports;
    const attributes = _.castArray(attribute);
    context.ports.write({
      data: data.map(item => itemWithSlug(item, attributes)),
    });
    return `Created slugs for ${data.length} items`;
  },
};

function itemWithSlug(item: Item, attributes: string[]) {
  if (item.slug) {
    return item;
  }
  const slugAttribute = attributes.find(attr => item[attr]);
  return slugAttribute
    ? {
        slug: slugify(item[slugAttribute], slugifyOptions),
        ...item,
      }
    : item;
}
