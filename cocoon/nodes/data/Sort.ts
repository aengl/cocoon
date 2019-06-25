import { CocoonNode } from '@cocoon/types';
import _ from 'lodash';

export interface Ports {
  data: object[];
  orderBy: string[];
  orders?: Array<'asc' | 'desc'>;
}

export const Sort: CocoonNode<Ports> = {
  category: 'Data',
  description: 'Sorts data.',

  in: {
    data: {
      required: true,
    },
    orderBy: {
      hide: true,
      required: true,
    },
    orders: {
      hide: true,
    },
  },

  out: {
    data: {},
  },

  async process(context) {
    const { data, orderBy, orders } = context.ports.read();
    context.ports.write({ data: _.orderBy(data, orderBy, orders) });
    return `Sorted ${data.length} items`;
  },
};
