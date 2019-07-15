export interface DimensionInfo {
  index: number;
  name: string;
}

type MapValueFunction = (x: any) => any;
type Dimension = [string, string, MapValueFunction];
type NamedDimension =
  | string
  | null
  | undefined
  | {
      attribute?: string;
      map?: MapValueFunction;
    };

const identity = (x: any) => x;
const nilToNull = (x: any) => (x === undefined ? null : x);
const mapNamedDimension = (key: string | undefined, d: NamedDimension) =>
  d
    ? typeof d === 'string'
      ? [key || d, d, x => x]
      : d.attribute
      ? [key || d.attribute, d.attribute, d.map || (x => x)]
      : null
    : null;

/**
 * Compacts data by converting it into an array containing just the specified
 * dimensions.
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
      .filter((x): x is Dimension => Boolean(x && x[0] && x[1])),
    ...((additionalDimensions
      ? additionalDimensions.map(x => [x, x, identity])
      : []) as Dimension[]),
  ];
  return {
    data: data.map(d => dimensionList.map(x => nilToNull(x[2](d[x[1]])))),
    dimensions: dimensionList.reduce((acc, x, i) => {
      acc[x[0]] = { name: x[1], index: i };
      return acc;
    }, {}) as {
      [key: string]: DimensionInfo;
    },
  };
}
