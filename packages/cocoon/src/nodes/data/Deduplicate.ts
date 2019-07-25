import { CocoonNode } from '@cocoon/types';
import castFunction from '@cocoon/util/castFunction';
import _ from 'lodash';

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
      required: true,
      visible: false,
    },
    data: {
      required: true,
    },
    pick: {
      visible: false,
    },
  },

  out: {
    data: {},
    removed: {},
  },

  async *process(context) {
    const { attribute, data, pick } = context.ports.read();
    const [deduplicated, removed] = deduplicate(
      data,
      attribute,
      pick ? castFunction<PickFunction>(pick) : _.identity
    );
    context.ports.write({
      data: deduplicated,
      removed,
    });
    return `Removed ${data.length - deduplicated.length} duplicates`;
  },
};

function deduplicate(data: object[], attribute: string, pick: PickFunction) {
  const map = new Map();
  const removed: typeof data = [];
  for (const item of data) {
    const key = _.get(item, attribute);
    const existingItem = map.get(key);
    if (existingItem) {
      const pickedItem = pick(item, existingItem);
      const pickedRemoved =
        pickedItem === item ? [item, existingItem] : [existingItem, item];
      removed.push({
        $duplicate: pickedRemoved[0],
        ...pickedRemoved[1],
      });
      map.set(key, pickedItem);
    } else {
      map.set(key, item);
    }
  }
  return [[...map.values()], removed];
}
