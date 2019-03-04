import _ from 'lodash';

export interface Position {
  x: number;
  y: number;
}

export interface GridPosition {
  col: number;
  row: number;
}

export const sortedRange = (x: [number, number]): [number, number] =>
  x[0] > x[1] ? [x[1], x[0]] : x;

export const limitRangePrecision = (x: [number, number]): [number, number] => [
  _.round(x[0], 5),
  _.round(x[1], 5),
];
