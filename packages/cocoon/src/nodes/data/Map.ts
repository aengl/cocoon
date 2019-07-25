import { CocoonNode } from '@cocoon/types';
import castFunction from '@cocoon/util/castFunction';
import _ from 'lodash';

export type MapFunction = (...args: any[]) => any;

export interface Ports {
  data: object[];
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
      context.ports.write({
        data: applyMap(data, map),
      });
      return `Mapped ${data.length} items`;
    }

    context.ports.write({
      data,
      filtered: [],
    });
    return `No mapping applied`;
  },
};

function applyMap(data: object[], map: Ports['map']) {
  const mapList = _.castArray<any>(map).map(x => castFunction<MapFunction>(x));
  let mappedData: any[] = data;
  for (const f of mapList) {
    mappedData = mappedData.map(f);
  }
  return mappedData;
}
