export default function(
  data: object[],
  predicate: (value: any, attribute: string) => boolean = () => true,
  slice = 10
) {
  const slicedData = slice ? data.slice(0, slice) : data;
  const dimensionSet = slicedData.reduce(
    (dimensions: Set<string>, item: object) => {
      Object.keys(item).forEach(key => {
        if (!dimensions.has(key) && predicate(item[key], key)) {
          dimensions.add(key);
        }
      });
      return dimensions;
    },
    new Set()
  );
  return [...dimensionSet.values()];
}
