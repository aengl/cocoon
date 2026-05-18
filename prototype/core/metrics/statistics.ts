/**
 * Verbatim port of legacy `@cocoon/plugin-distance/statistics.ts`. `quantile`
 * comes from the faithful d3-array port (`./numeric.ts`); `_.isNil` from
 * `core/lodash-lite.ts`. Semantics — including the *deliberate* call of
 * `quantile` on the unsorted array before the `.sort()` (harmless: the port
 * is order-independent, exactly like legacy d3-array's quickselect) — are
 * preserved. Do not "improve" — this defines compatibility.
 */
import { quantile } from './numeric.ts';
import { isNil } from '../lodash-lite.ts';

/**
 * Returns the lower and upper bounds of the IQR.
 *
 * The IQR is used for creating a domain that can clip outliers. It is
 * calculated by taking the midspread (IQR for .25 and .75 quantiles) and
 * adding a multiple of the midspread range to its upper and lower bound.
 *
 * @param range Multiplier for the midrange for constructing the IQR bounds.
 * Passing 0 is equivalent to only taking the midspread.
 * @param values The values to calculate the IQR range over.
 */
export function interquartileRange(
  range: number,
  values: number[]
): [number, number] {
  const filteredValues = values.filter(v => !isNil(v));

  if (filteredValues.length === 0) {
    throw new Error(`failed to calculate IQR: No valid values`);
  }

  if (quantile(filteredValues, 0.25) === quantile(filteredValues, 0.75)) {
    return [filteredValues[0], filteredValues[0]];
  }

  filteredValues.sort((a, b) => a - b);
  const iqr = [quantile(filteredValues, 0.25), quantile(filteredValues, 0.75)];
  if (iqr.some(v => v === undefined)) {
    throw new Error(`failed to calculate IQR - test`);
  }
  const extension = range * (iqr[1]! - iqr[0]!);
  return [iqr[0]! - extension, iqr[1]! + extension];
}

/**
 * Creates a domain function. Values that are outside the domain will be
 * clipped to the closest domain boundary.
 * @param bounds The lower and upper bounds for the domain.
 */
export function domain(bounds: [number, number]) {
  return (v: number) =>
    isNil(v) ? v : Math.max(bounds[0], Math.min(bounds[1], v));
}
