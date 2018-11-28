/**
 * Checks if a data key is a meta key.
 * @param key The data key.
 */
export const isMetaKey = (key: string) =>
  key.startsWith('$') || key.startsWith('_');

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
