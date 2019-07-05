import { CocoonNode } from '@cocoon/types';
import castFunction from '@cocoon/util/castFunction';
import _ from 'lodash';

export interface Ports {
  data: object[];
  map: any;
}

export const Map: CocoonNode<Ports> = {
  category: 'Data',
  description: `Maps items in a collection using a mapping function.`,

  in: {
    data: {
      required: true,
    },
    map: {
      hide: true,
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

function applyMap(data: object[], filter: any) {
  const mapList = _.castArray(filter).map(x =>
    castFunction<(...args: any[]) => any>(x)
  );
  let mappedData = data;
  for (const f of mapList) {
    mappedData = mappedData.map(f);
  }
  return mappedData;
}
