import Qty from 'js-quantities';
import _ from 'lodash';
import { listDimensions, NodeContext, NodeObject } from '..';

const Convert: NodeObject = {
  in: {
    data: {
      required: true,
    },
  },

  out: {
    data: {},
  },

  process: async context => {
    const data = context.cloneFromPort<object[]>('data');
    const dimensions = listDimensions(data);
    const convertedValues = dimensions.reduce((all, d) => {
      all[d] = convertDimension(d, data.map(x => x[d]), context.debug);
      return all;
    }, {});
    const convertedData = data.map((item, i) =>
      Object.keys(item).reduce((all, d) => {
        all[d] = convertedValues[d][i];
        return all;
      }, {})
    );
    context.writeToPort<object[]>('data', convertedData);
    return `converted ${data.length} item(s)`;
  },
};

export { Convert };

const numberRegex = /^(?<number>-?(?:0|[1-9,]\d*)(?:[.,]\d+)|(?:\d+))$/;
const quantityRegex = /^(?<value>-?(?:0|[1-9,]\d*)(?:[.,]\d+)|(?:\d+))(?<gap>[\s|\/]+)?(?<unit>[^0-9.,\s)]+)$/;

function convertDimension(
  d: string,
  values: any[],
  debug: NodeContext['debug']
): any[] {
  if (!values.some(x => !_.isNil(x))) {
    // Dimension has no values
    return values;
  }
  const allStrings = !values.some(x => !_.isString(x) && !_.isNil(x));
  if (allStrings) {
    try {
      const newValues = convertStringsToNumbers(values);
      debug(`auto-converted dimension "${d}" to numbers`);
      return newValues;
    } catch (error) {
      // Ignore
    }
    try {
      const newValues = convertQuantitiesToNumbers(values);
      debug(`auto-converted dimension "${d}" to quantities`);
      return newValues;
    } catch (error) {
      // Ignore
    }
  }
  return values;
}

function convertStringsToNumbers(values: string[]): Array<null | number> {
  return values.map(x =>
    _.isNil(x) ? null : parseFloat(x.match(numberRegex)!.groups!.number)
  );
}

function convertQuantitiesToNumbers(values: string[]): Array<null | number> {
  const matches = values.map(x =>
    _.isNil(x) ? null : x.match(quantityRegex)!.groups
  );
  const units = matches.filter(x => Boolean(x)).map(x => x!.unit);
  const unitCount = _.countBy(units);
  const mostCommonUnit = _.chain(unitCount)
    .toPairs()
    .maxBy(_.last)
    .head()
    .value() as string;
  return values.map(x =>
    _.isNil(x) ? null : new Qty(x).to(mostCommonUnit).scalar
  );
}
