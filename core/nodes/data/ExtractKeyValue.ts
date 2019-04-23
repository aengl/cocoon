import _ from 'lodash';
import { NodeObject } from '../../../common/node';

export interface Ports {
  attribute: string;
  data: object[];
  key: string;
  value: string;
}

export const ExtractKeyValue: NodeObject<Ports> = {
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
    const ports = context.ports.read();
    let numConverted = 0;
    const data = context.ports.copy(ports.data).map(item => {
      const keyValueData: object | object[] = _.get(item, ports.attribute);
      if (keyValueData === undefined) {
        return item;
      }
      const newItem = _.omit(item, ports.attribute);
      const keyValueArray = _.isArray(keyValueData)
        ? keyValueData
        : Object.values(keyValueData);
      keyValueArray.forEach(entry => {
        const key = entry[ports.key];
        const value = entry[ports.value];
        if (key !== undefined && value !== undefined) {
          newItem[key] = value;
        }
      });
      numConverted += 1;
      return newItem;
    });
    context.ports.write({ data });
    return `Converted ${numConverted} items`;
  },
};
