import _ from 'lodash';

export const sortedRange = (x: [number, number]): [number, number] =>
  x[0] > x[1] ? [x[1], x[0]] : x;

export const limitRangePrecision = (x: [number, number]): [number, number] => [
  _.round(x[0], 5),
  _.round(x[1], 5),
];
