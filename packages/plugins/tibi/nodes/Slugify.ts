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
  data: Array<{ slug?: string }>;
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
    const dataWithSlugs: Ports['data'] = [];
    for (let i = 0; i < data.length; i++) {
      dataWithSlugs.push(itemWithSlug(data[i], attributes));
      if (i % 500) {
        yield [`Created slugs for ${i} items`, i / data.length];
      }
    }
    context.ports.write({
      data: dataWithSlugs,
    });
    return `Created slugs for ${data.length} items`;
  },
};

function itemWithSlug(item: { slug?: string }, attributes: string[]) {
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
