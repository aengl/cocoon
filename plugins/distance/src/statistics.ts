import { quantile } from 'd3-array';
import _ from 'lodash';

/**
 * Returns the lower and upper bounds of the IQR.
 *
 * The IQR is used for creating a domain that can clip outliers. It is
 * calculated by taking the midspread (IQR for .25 and .75 quantiles) and adding
 * a multiple of the midspread range to its upper and lower bound.
 *
 * For more information, see: https://en.wikipedia.org/wiki/Interquartile_range
 *
 * See: https://en.wikipedia.org/wiki/Interquartile_range
 * @param range Multiplier for the midrange for constructing the IQR bounds.
 * Passing 0 is equivalent to only taking the midspread.
 * @param values The values to calculate the IQR range over.
 */
export function interquartileRange(
  range: number,
  values: number[]
): [number, number] {
  const filteredValues = values.filter(v => !_.isNil(v));
  filteredValues.sort((a, b) => a - b);
  const iqr = [quantile(filteredValues, 0.25), quantile(filteredValues, 0.75)];
  if (iqr.some(v => v === undefined)) {
    throw new Error(`failed to calculate IQR`);
  }
  const extension = range * (iqr[1]! - iqr[0]!);
  return [iqr[0]! - extension, iqr[1]! + extension];
}

/**
 * Creates a domain function. Values that are outside the domain will be clipped
 * to the closest domain boundary.
 * @param bounds: The lower and upper bounds for the domain.
 */
export function domain(bounds: [number, number]) {
  return (v: number) =>
    _.isNil(v) ? v : Math.max(bounds[0], Math.min(bounds[1], v));
}
