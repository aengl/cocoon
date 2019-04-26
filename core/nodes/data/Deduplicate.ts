import _ from 'lodash';
import { castFunction } from '../../../common/cast';
import { CocoonNode } from '../../../common/node';

export interface Ports {
  attribute: string;
  data: object[];
  pick: string | PickFunction;
}

export type PickFunction = (item: object, existingItem: object) => object;

export const Deduplicate: CocoonNode<Ports> = {
  category: 'Data',
  description: `Removes duplicates from a collection using a unique primary key attribute`,

  in: {
    attribute: {
      defaultValue: '_id',
      hide: true,
    },
    data: {
      required: true,
    },
    pick: {
      hide: true,
    },
  },

  out: {
    data: {},
  },

  async process(context) {
    const { attribute, data, pick } = context.ports.read();
    const dedupedData = pick
      ? dedupe(data, attribute, castFunction<PickFunction>(pick))
      : _.uniqBy(data, attribute);
    context.ports.write({ data: dedupedData });
    return `Removed ${data.length - dedupedData.length} duplicates`;
  },
};

function dedupe(data: object[], attribute: string, pick: PickFunction) {
  const map = new Map();
  // tslint:disable-next-line no-eval
  for (const item of data) {
    const key = _.get(item, attribute);
    const existingItem = map.get(key);
    if (existingItem) {
      const pickedItem = pick(item, existingItem);
      map.set(key, pickedItem);
    } else {
      map.set(key, item);
    }
  }
  return [...map.values()];
}
