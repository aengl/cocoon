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
    context.ports.write({
      data: data.map(item => itemWithSlug(item, attribute)),
    });
    return `Created slugs for ${data.length} items`;
  },
};

function itemWithSlug(item: Item, attribute: Ports['attribute']) {
  if (item.slug) {
    return item;
  }
  const slugAttribute = _.castArray(attribute).find(attr => item[attr]);
  return slugAttribute
    ? {
        slug: slugify(item[slugAttribute], slugifyOptions),
        ...item,
      }
    : item;
}
