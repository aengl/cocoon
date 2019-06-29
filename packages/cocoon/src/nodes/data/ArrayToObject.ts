import { CocoonNode } from '@cocoon/types';

export interface Ports {
  attributes: {
    [name: string]: number;
  };
  data: any[][];
}

export const ArrayToObject: CocoonNode<Ports> = {
  category: 'Data',
  description: `Transforms arrays into data object by mapping indices to keys.`,

  in: {
    attributes: {
      required: true,
    },
    data: {
      required: true,
    },
  },

  out: {
    data: {},
  },

  async process(context) {
    const { attributes, data } = context.ports.read();
    const attributeKeys = Object.keys(attributes);
    context.ports.write({
      data: data.map(row =>
        attributeKeys.reduce((obj, x) => {
          obj[x] = row[convertNegativeIndex(attributes[x], row.length)];
          return obj;
        }, {})
      ),
    });
    return `Converted ${data.length} items`;
  },
};

const convertNegativeIndex = (index: number, length: number) =>
  index < 0 ? length + index : index % length;
