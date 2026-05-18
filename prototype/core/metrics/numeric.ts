/**
 * Faithful, zero-dep ports of the third-party numeric helpers the legacy
 * `@cocoon/plugin-distance` metrics relied on — pinned to the *exact* legacy
 * versions so the parity-locked `Score` node stays bit-for-bit (ranking order
 * is the whole point of the Tibi flows; a subtly different scale/quantile
 * silently reorders production rankings). The metrics analogue of
 * `core/lodash-lite.ts` / `core/cast-function.ts`: the prototype core keeps
 * its no-npm-deps stance while the port stays behaviourally identical.
 *
 *   - `scaleLinear`            — d3-scale 3.3.0 (continuous + linear, the
 *                                numeric/clamp/polylinear subset actually used)
 *   - `quantile`              — d3-array 2.12.1 (quickselect-based, so
 *                                order-independent like the original)
 *   - `median`,
 *     `medianAbsoluteDeviation`,
 *     `linearRegression`,
 *     `linearRegressionLine`  — simple-statistics 7.7.0
 *   - `compareTwoStrings`     — string-similarity 4.0.4 (Sørensen–Dice)
 *
 * Do not "improve" these — they define compatibility.
 */

/* --------------------------------------------------------------------- *
 * d3-scale 3.3.0 — `scaleLinear` (continuous.js + linear.js).
 * transform = identity, interpolate = interpolateNumber (numeric range).
 * Only `.domain` / `.range` / `.clamp` are reachable from the metrics.
 * --------------------------------------------------------------------- */

type ScaleFn = (x: number) => number;

const constant = (x: number) => () => x;

/** d3 `normalize(a, b)`. */
function normalize(a: number, b: number): ScaleFn {
  b -= a = +a;
  return b ? (x: number) => (x - a) / b : constant(isNaN(b) ? NaN : 0.5);
}

/** d3 `clamper(a, b)`. */
function clamper(a: number, b: number): ScaleFn {
  let t: number;
  if (a > b) {
    t = a;
    a = b;
    b = t;
  }
  return (x: number) => Math.max(a, Math.min(b, x));
}

/** d3-interpolate `interpolateNumber(a, b)` (the default for numeric range). */
function interpolateNumber(a: number, b: number): ScaleFn {
  a = +a;
  b = +b;
  return (t: number) => a * (1 - t) + b * t;
}

/** d3-array `bisectRight(a, x, lo, hi)` (ascending comparator default). */
function bisectRight(a: number[], x: number, lo: number, hi: number): number {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (x < a[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function bimap(domain: number[], range: number[]): ScaleFn {
  const d0v = domain[0];
  const d1v = domain[1];
  const r0v = range[0];
  const r1v = range[1];
  let d0: ScaleFn;
  let r0: ScaleFn;
  if (d1v < d0v) {
    d0 = normalize(d1v, d0v);
    r0 = interpolateNumber(r1v, r0v);
  } else {
    d0 = normalize(d0v, d1v);
    r0 = interpolateNumber(r0v, r1v);
  }
  return (x: number) => r0(d0(x));
}

function polymap(domain: number[], range: number[]): ScaleFn {
  const j = Math.min(domain.length, range.length) - 1;
  const d: ScaleFn[] = new Array(j);
  const r: ScaleFn[] = new Array(j);
  // Reverse descending domains.
  if (domain[j] < domain[0]) {
    domain = domain.slice().reverse();
    range = range.slice().reverse();
  }
  let i = -1;
  while (++i < j) {
    d[i] = normalize(domain[i], domain[i + 1]);
    r[i] = interpolateNumber(range[i], range[i + 1]);
  }
  return (x: number) => {
    const k = bisectRight(domain, x, 1, j) - 1;
    return r[k](d[k](x));
  };
}

export interface LinearScale {
  (x: number): number | undefined;
  domain(d: number[]): LinearScale;
  range(r: number[]): LinearScale;
  clamp(c: boolean): LinearScale;
}

/** d3-scale 3.3.0 `scaleLinear()` (identity transform, numeric interpolate). */
export function scaleLinear(): LinearScale {
  let domain = [0, 1];
  let range = [0, 1];
  const identity: ScaleFn = (x) => x;
  let clamp: ScaleFn = identity;
  let clampOn = false;
  let piecewise: (d: number[], r: number[]) => ScaleFn = bimap;
  let output: ScaleFn | null = null;

  function rescale(): LinearScale {
    const n = Math.min(domain.length, range.length);
    clamp = clampOn ? clamper(domain[0], domain[n - 1]) : identity;
    piecewise = n > 2 ? polymap : bimap;
    output = null;
    return scale;
  }

  function scale(x: number): number | undefined {
    if (x == null || isNaN((x = +x))) return undefined;
    if (!output) output = piecewise(domain, range);
    return output(clamp(x));
  }

  scale.domain = (d: number[]): LinearScale => {
    domain = Array.from(d, Number);
    return rescale();
  };
  scale.range = (r: number[]): LinearScale => {
    range = Array.from(r, Number);
    return rescale();
  };
  scale.clamp = (c: boolean): LinearScale => {
    clampOn = !!c;
    return rescale();
  };

  return rescale();
}

/* --------------------------------------------------------------------- *
 * d3-array 2.12.1 — `quantile`. The quickselect implementation is
 * order-independent; the returned value equals the classic linear
 * interpolation on the sorted data, so we compute the order statistics from
 * a sorted copy (numerically identical, and likewise order-independent — the
 * legacy `interquartileRange` calls it before sorting on purpose).
 * --------------------------------------------------------------------- */

function d3min(arr: ArrayLike<number>): number | undefined {
  let m: number | undefined;
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i];
    if (x != null && (m === undefined ? x >= x : m > x)) m = x;
  }
  return m;
}

function d3max(arr: ArrayLike<number>): number | undefined {
  let m: number | undefined;
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i];
    if (x != null && (m === undefined ? x >= x : m < x)) m = x;
  }
  return m;
}

export function quantile(
  values: ReadonlyArray<number | null | undefined>,
  p: number
): number | undefined {
  const n = values.length;
  if (!n) return undefined;
  const v = Float64Array.from(values as number[], (x) =>
    x === null ? NaN : +(x as number)
  );
  if ((p = +p) <= 0 || n < 2) return d3min(v);
  if (p >= 1) return d3max(v);
  const i = (n - 1) * p;
  const i0 = Math.floor(i);
  const sorted = v.slice().sort();
  const value0 = sorted[i0];
  const value1 = sorted[i0 + 1];
  return value0 + (value1 - value0) * (i - i0);
}

/* --------------------------------------------------------------------- *
 * simple-statistics 7.7.0 — median / MAD / linear regression.
 * --------------------------------------------------------------------- */

/** ss `numericSort` — a numerically-sorted *copy*. */
function numericSort(x: ReadonlyArray<number>): number[] {
  return x.slice().sort((a, b) => a - b);
}

/** ss `quantileSorted(x, p)`. */
function quantileSorted(x: number[], p: number): number {
  const idx = x.length * p;
  if (x.length === 0) {
    throw new Error('quantile requires at least one data point.');
  } else if (p < 0 || p > 1) {
    throw new Error('quantiles must be between 0 and 1');
  } else if (p === 1) {
    return x[x.length - 1];
  } else if (p === 0) {
    return x[0];
  } else if (idx % 1 !== 0) {
    return x[Math.ceil(idx) - 1];
  } else if (x.length % 2 === 0) {
    return (x[idx - 1] + x[idx]) / 2;
  } else {
    return x[idx];
  }
}

/** ss `median(x)` = `quantileSorted(numericSort(x), 0.5)`. */
export function median(x: ReadonlyArray<number>): number {
  return quantileSorted(numericSort(x), 0.5);
}

/** ss `medianAbsoluteDeviation(x)`. */
export function medianAbsoluteDeviation(x: ReadonlyArray<number>): number {
  const medianValue = median(x);
  const deviations: number[] = [];
  for (let i = 0; i < x.length; i++) {
    deviations.push(Math.abs(x[i] - medianValue));
  }
  return median(deviations);
}

export interface RegressionCoefficients {
  m: number;
  b: number;
}

/** ss `linearRegression(data)` (data = `[x, y]` pairs). */
export function linearRegression(
  data: ReadonlyArray<[number, number]>
): RegressionCoefficients {
  let m: number;
  let b: number;
  if (data.length === 1) {
    m = 0;
    b = data[0][1];
  } else {
    let sumX = 0;
    let sumY = 0;
    let sumXX = 0;
    let sumXY = 0;
    for (let i = 0; i < data.length; i++) {
      const point = data[i];
      const x = point[0];
      const y = point[1];
      sumX += x;
      sumY += y;
      sumXX += x * x;
      sumXY += x * y;
    }
    m = (data.length * sumXY - sumX * sumY) / (data.length * sumXX - sumX * sumX);
    b = sumY / data.length - (m * sumX) / data.length;
  }
  return { m, b };
}

/** ss `linearRegressionLine({m, b})`. */
export function linearRegressionLine(
  mb: RegressionCoefficients
): (x: number) => number {
  return (x: number) => mb.b + mb.m * x;
}

/* --------------------------------------------------------------------- *
 * string-similarity 4.0.4 — `compareTwoStrings` (Sørensen–Dice bigrams).
 * --------------------------------------------------------------------- */

export function compareTwoStrings(first: string, second: string): number {
  first = first.replace(/\s+/g, '');
  second = second.replace(/\s+/g, '');

  if (first === second) return 1; // identical or empty
  if (first.length < 2 || second.length < 2) return 0; // 0/1-letter string

  const firstBigrams = new Map<string, number>();
  for (let i = 0; i < first.length - 1; i++) {
    const bigram = first.substring(i, i + 2);
    const count = firstBigrams.has(bigram)
      ? (firstBigrams.get(bigram) as number) + 1
      : 1;
    firstBigrams.set(bigram, count);
  }

  let intersectionSize = 0;
  for (let i = 0; i < second.length - 1; i++) {
    const bigram = second.substring(i, i + 2);
    const count = firstBigrams.has(bigram)
      ? (firstBigrams.get(bigram) as number)
      : 0;
    if (count > 0) {
      firstBigrams.set(bigram, count - 1);
      intersectionSize++;
    }
  }

  return (2.0 * intersectionSize) / (first.length + second.length - 2);
}
