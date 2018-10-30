import { IDebugger } from 'debug';
import _ from 'lodash';
import { ICocoonNode, listDimensions } from '..';

export interface IConvertConfig {}

const Convert: ICocoonNode<IConvertConfig> = {
  in: {
    data: {
      required: true,
    },
  },

  out: {
    data: {},
  },

  process: async context => {
    const { debug } = context;
    const data = context.readFromPort<object[]>('data');
    const dimensions = listDimensions(data);
    const converterValues = dimensions.reduce((all, d) => {
      all[d] = convertDimension(d, data.map(x => x[d]), context.debug);
      return all;
    }, {});
    const convertedData = data.map((item, i) =>
      Object.keys(item).reduce((all, d) => {
        all[d] = converterValues[d][i];
        return all;
      }, {})
    );
    context.writeToPort<object[]>('data', convertedData);
    return `converted ${data.length} item(s)`;
  },
};

export { Convert };

function convertDimension(d: string, values: any[], debug: IDebugger): any[] {
  const allStrings = !values.some(x => !_.isString(x));
  if (allStrings) {
    try {
      const newValues = convertStringsToNumber(values);
      debug(`auto-converted dimension "${d}" to numbers`);
      return newValues;
    } catch (error) {
      // Ignore
    }
  }
  return values;
}

function convertStringsToNumber(values: any[]): number[] {
  return values.map(x => parseFloat(x));
}
