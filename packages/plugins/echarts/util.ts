import { DimensionInfo } from '@cocoon/util/serialiseDataForView';
import _ from 'lodash';

export const sortedRange = (x: [number, number]): [number, number] =>
  x[0] > x[1] ? [x[1], x[0]] : x;

export const limitRangePrecision = (x: [number, number]): [number, number] => [
  _.round(x[0], 5),
  _.round(x[1], 5),
];

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
