import _ from 'lodash';
import { NodeObject } from '../../../common/node';

export const ExtractKeyValue: NodeObject = {
  category: 'Data',

  in: {
    attribute: {
      hide: true,
      required: true,
    },
    data: {
      required: true,
    },
    key: {
      defaultValue: 'key',
      hide: true,
    },
    value: {
      defaultValue: 'value',
      hide: true,
    },
  },

  out: {
    data: {},
  },

  async process(context) {
    const data = context.ports.copy<object[]>('data');
    const attribute = context.ports.read<string>('attribute');
    const configKey = context.ports.read<string>('key');
    const configValue = context.ports.read<string>('value');
    let numConverted = 0;
    context.ports.writeAll({
      data: data.map(item => {
        const keyValueData: object | object[] = _.get(item, attribute);
        if (keyValueData === undefined) {
          return item;
        }
        const newItem = _.omit(item, attribute);
        const keyValueArray = _.isArray(keyValueData)
          ? keyValueData
          : Object.values(keyValueData);
        keyValueArray.forEach(entry => {
          const key = entry[configKey];
          const value = entry[configValue];
          if (key !== undefined && value !== undefined) {
            newItem[key] = value;
          }
        });
        numConverted += 1;
        return newItem;
      }),
    });
    return `Converted ${numConverted} items`;
  },
};
