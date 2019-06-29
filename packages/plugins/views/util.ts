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
