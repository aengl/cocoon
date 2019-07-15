import { CocoonNode } from '@cocoon/types';
import _ from 'lodash';

export interface Ports {
  data: object[];
  orderBy: string | string[];
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
    unsortable: {},
  },

  async *process(context) {
    const { data, orderBy, orders } = context.ports.read();
    const attributes = _.castArray(orderBy);
    const [unsortable, unsorted] = _.partition(data, x =>
      attributes.some(y => _.isNil(x[y]))
    );
    context.ports.write({
      data: _.orderBy(unsorted, orderBy, orders),
      unsortable,
    });
    return `Sorted ${unsorted.length} items`;
  },
};
