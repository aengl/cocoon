import _ from 'lodash';
import { ICocoonNode, readInputPort, writeOutput } from '..';

export interface IExtractKeyValueConfig {
  attribute: string;
  key?: string;
  value?: string;
}

const ExtractKeyValue: ICocoonNode<IExtractKeyValueConfig> = {
  in: {
    data: {
      required: true,
    },
  },

  out: {
    data: {},
  },

  process: async context => {
    const data = readInputPort(context.node, 'data') as object[];
    const configKey = context.config.key || 'key';
    const configValue = context.config.value || 'value';
    let numConverted = 0;
    writeOutput(
      context.node,
      'data',
      data.map(item => {
        const keyValueData: object | object[] = _.get(
          item,
          context.config.attribute
        );
        if (keyValueData === undefined) {
          return item;
        }
        const newItem = _.omit(item, context.config.attribute);
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
