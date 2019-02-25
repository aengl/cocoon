import _ from 'lodash';
import { castFunction } from '../../../common/cast';
import { NodeObject } from '../../../common/node';

export type PickFunction = (item: object, existingItem: object) => object;

export const Deduplicate: NodeObject = {
  category: 'Data',

  in: {
    attribute: {
      defaultValue: '_id',
    },
    data: {
      required: true,
    },
    pick: {},
  },

  out: {
    data: {},
  },

  async process(context) {
    const data = context.readFromPort<object[]>('data');
    const attribute = context.readFromPort<string>('attribute');
    const pick = context.readFromPort<string | PickFunction>('pick');
    const dedupedData = pick
      ? dedupe(data, attribute, castFunction<PickFunction>(pick))
      : _.uniqBy(data, attribute);
    context.writeToPort<object[]>('data', dedupedData);
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
