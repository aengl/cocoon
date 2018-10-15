import _ from 'lodash';
import { ICocoonNode, readInputPort, writeOutput } from '..';
import { Context } from '../../context';

const debug = require('debug')('cocoon:ExtractKeyValue');

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

  process: async (config: IExtractKeyValueConfig, context: Context) => {
    const data = readInputPort(context.node, 'data') as object[];
    const configKey = config.key || 'key';
    const configValue = config.value || 'value';
    writeOutput(
      context.node,
      'data',
      data.map(item => {
        const keyValueData: object | object[] = _.get(item, config.attribute);
        if (keyValueData === undefined) {
          return item;
        }
        const newItem = _.omit(item, config.attribute);
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
        return newItem;
      })
    );
  },
};

module.exports = { ExtractKeyValue };
