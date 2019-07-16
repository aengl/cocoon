export interface DimensionInfo {
  index: number;
  name: string | null;
}

type MapValueFunction = (value: any, index: number) => any;
type GeneratorFunction = (item: object, index: number) => any;
type Dimension = [string, string | null, MapValueFunction | GeneratorFunction];
type NamedDimension =
  | string
  | GeneratorFunction
  | null
  | undefined
  | {
      attribute: string;
      map?: MapValueFunction;
    };

const identity = (x: any) => x;
const nilToNull = (x: any) => (x === undefined ? null : x);
const mapNamedDimension = (
  key: string | undefined,
  d: NamedDimension
): Dimension | null =>
  d
    ? typeof d === 'string'
      ? [key || d, d, x => x]
      : typeof d === 'function'
      ? [key || 'generated', null, d]
      : [key || d.attribute, d.attribute, d.map || (x => x)]
    : null;

/**
 * Compacts data by converting it into an array containing just the specified
 * dimensions.
 *
 * The last dimension will always be the data index, so that the encoded data
 * can be correlated with the original data, even after sampling/filtering it.
 * @param data The data that is serialised.
 * @param namedDimensions Describes the data dimensions that are serialised.
 * @param additionalDimensions An array of additional unnamed dimensions to
 * serialise.
 */
export default function(
  data: object[],
  namedDimensions: {
    [name: string]: NamedDimension | null | undefined;
  },
  additionalDimensions?: string[]
) {
  const dimensionList = [
    ...Object.keys(namedDimensions)
      .map(x => mapNamedDimension(x, namedDimensions[x]))
      .filter((x): x is Dimension => Boolean(x)),
    ...((additionalDimensions
      ? additionalDimensions.map(x => [x, x, identity])
      : []) as Dimension[]),
  ];
  return {
    data: data.map((d, i) =>
      dimensionList.map(x =>
        x[1] !== null
          ? // Get value for the attribute x[1] and map it using x[2]
            nilToNull(x[2](d[x[1]], i))
          : // Generate a value from data using x[2]
            x[2](d, i)
      )
    ),
    dimensions: dimensionList.reduce((acc, x, i) => {
      acc[x[0]] = { name: x[1], index: i };
      return acc;
    }, {}) as {
      [key: string]: DimensionInfo;
    },
  };
}
