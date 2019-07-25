import { CocoonNode } from '@cocoon/types';
import castFunction from '@cocoon/util/castFunction';
import _ from 'lodash';

export type MapFunction = (...args: any[]) => any;

export interface Ports {
  data: unknown;
  map: string | string[] | MapFunction | MapFunction[];
}

export const Map: CocoonNode<Ports> = {
  category: 'Data',
  description: `Converts items in a collection using a mapping function.`,

  in: {
    data: {
      description: `The data to filter.`,
      required: true,
    },
    map: {
      description: `One or more mapping functions that will be applied to each data item.`,
      visible: false,
    },
  },

  out: {
    data: {},
  },

  async *process(context) {
    const { data, map } = context.ports.read();
    if (map) {
      const mapList = _.castArray<any>(map).map(x =>
        castFunction<MapFunction>(x)
      );
      if (_.isArray(data)) {
        context.ports.write({
          data: mapList.reduce((acc, x) => acc.map(x), data),
        });
        return `Mapped ${data.length} items`;
      } else {
        context.ports.write({
          data: mapList.reduce((acc, x) => x(acc), data as any),
        });
        return `Mapped a single item`;
      }
    }
    context.ports.write({ data });
    return `No mapping applied`;
  },
};
