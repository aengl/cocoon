import { DimensionInfo } from '@cocoon/util/serialiseDataForView';
import { max, min, quantile } from 'd3-array';
import _ from 'lodash';

export type NumericRange = [number, number];
export type NumericRangeOrNil = [
  number | undefined | null,
  number | undefined | null
];

export const sortedRange = (x: NumericRange): NumericRange =>
  x[0] > x[1] ? [x[1], x[0]] : x;

export const limitRangePrecision = (x: NumericRange): NumericRange => [
  _.round(x[0], 5),
  _.round(x[1], 5),
];

export const isNumericRange = (x: NumericRangeOrNil): x is NumericRange =>
  !x.some(_.isNil);

export const createTooltip = (dimensions: {
  [name: string]: DimensionInfo | undefined;
}) => ({
  backgroundColor: 'rgba(0, 0, 0, 0.7)',
  formatter: obj =>
    obj.value
      ? _.uniqBy(Object.keys(dimensions).map(x => dimensions[x]!), x => x.name)
          .filter(x => !_.isNil(x.name))
          .map(x => `${x.name}: ${shorten(obj.value![x.index])}`)
          .join('<br />')
      : '',
  textStyle: {
    fontFamily: 'Roboto',
    fontSize: 12,
  },
});

export const shorten = (x: unknown, maxLength = 28) =>
  _.isString(x) && x.length > maxLength ? `${x.slice(0, maxLength - 8)}...` : x;

export const interquartileRange = (values: number[]): NumericRangeOrNil => {
  const filteredValues = values.filter(v => !_.isNil(v));
  filteredValues.sort((a, b) => a - b);
  const iqr: NumericRangeOrNil = [
    quantile(filteredValues, 0.25),
    quantile(filteredValues, 0.75),
  ];
  if (!isNumericRange(iqr)) {
    return [null, null];
  }
  const range = iqr[1] - iqr[0];
  return [iqr[0] - range, iqr[1] + range];
};

export const minMaxRange = (values: number[]): NumericRangeOrNil => [
  min(values),
  max(values),
];

export const createDomain = (
  data: any[][],
  dimension?: DimensionInfo,
  iqr?: boolean
): NumericRangeOrNil =>
  dimension
    ? iqr
      ? interquartileRange(data.map(d => d[dimension.index]))
      : minMaxRange(data.map(d => d[dimension.index]))
    : [null, null];
