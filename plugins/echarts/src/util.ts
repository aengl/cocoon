import _ from 'lodash';

export function listDimensions(
  data: object[],
  predicate: (value: any, dimensionName: string) => boolean = () => true
) {
  const dimensionSet = data.reduce((dimensions: Set<string>, item: object) => {
    Object.keys(item).forEach(key => {
      if (!dimensions.has(key) && predicate(item[key], key)) {
        dimensions.add(key);
      }
    });
    return dimensions;
  }, new Set());
  return [...dimensionSet.values()];
}

export const sortedRange = (x: [number, number]): [number, number] =>
  x[0] > x[1] ? [x[1], x[0]] : x;

export const limitRangePrecision = (x: [number, number]): [number, number] => [
  _.round(x[0], 5),
  _.round(x[1], 5),
];
