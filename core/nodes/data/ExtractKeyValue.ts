import _ from 'lodash';
import { ICocoonNode } from '..';

const ExtractKeyValue: ICocoonNode = {
  in: {
    attribute: {
      required: true,
    },
    data: {
      required: true,
    },
    key: {
      defaultValue: 'key',
    },
    value: {
      defaultValue: 'value',
    },
  },

  out: {
    data: {},
  },

  process: async context => {
    const data = context.cloneFromPort<object[]>('data');
    const attribute = context.readFromPort<string>('attribute');
    const configKey = context.readFromPort<string>('key');
    const configValue = context.readFromPort<string>('value');
    let numConverted = 0;
    context.writeToPort<object[]>(
      'data',
      data.map(item => {
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
      })
    );
    return `converted ${numConverted} item(s)`;
  },
};

export { ExtractKeyValue };
