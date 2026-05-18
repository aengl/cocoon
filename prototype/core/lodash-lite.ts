/**
 * Faithful, zero-dep slices of the lodash functions the ported legacy
 * `@cocoon/cocoon` data/io nodes relied on. Same role as `cast-function.ts`
 * (a documented behaviour-equivalent of one legacy util), so the prototype
 * core keeps its no-npm-deps stance while the node ports stay behaviourally
 * identical — `orderBy` in particular reproduces lodash 4.17's
 * `compareAscending` ordering verbatim because Tibi's whole thesis is
 * "lists ordered by hard metrics": a subtly different sort silently reorders
 * production rankings.
 */

export const isNil = (v: unknown): v is null | undefined => v == null;

export const isObject = (v: unknown): v is object => {
  const t = typeof v;
  return v != null && (t === 'object' || t === 'function');
};

const isPlainArray = Array.isArray;

/** lodash path → key list: `a.b[0].c` → `['a','b','0','c']`. */
function toPath(path: string | (string | number)[]): (string | number)[] {
  if (Array.isArray(path)) return path;
  const out: (string | number)[] = [];
  String(path).replace(
    /[^.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]/g,
    (m, num, _q, str) => {
      out.push(num !== undefined ? num : str !== undefined ? str : m);
      return '';
    }
  );
  return out;
}

/** lodash `_.get`. */
export function get(
  object: unknown,
  path: string | (string | number)[],
  defaultValue?: unknown
): unknown {
  let value: unknown = object;
  for (const key of toPath(path)) {
    if (value == null) return defaultValue;
    value = (value as Record<string, unknown>)[key as string];
  }
  return value === undefined ? defaultValue : value;
}

/** lodash `_.omitBy(obj, _.isNil)` over own enumerable string keys. */
export function omitNil<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) if (!isNil(obj[k])) out[k] = obj[k];
  return out as Partial<T>;
}

/** lodash `_.pick` (flat keys — the only form the ported nodes use). */
export function pick<T extends Record<string, unknown>>(
  obj: T,
  keys: string[]
): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (obj != null && k in obj) out[k] = obj[k];
  return out as Partial<T>;
}

/** lodash `_.partition`: `[pass, fail]`. */
export function partition<T>(
  arr: T[],
  pred: (x: T) => unknown
): [T[], T[]] {
  const pass: T[] = [];
  const fail: T[] = [];
  for (const x of arr) (pred(x) ? pass : fail).push(x);
  return [pass, fail];
}

/** lodash `_.merge` — deep, mutating, skips `undefined` sources. */
export function merge<T extends Record<string, unknown>>(
  target: T,
  ...sources: unknown[]
): T {
  for (const src of sources) {
    if (src == null || typeof src !== 'object') continue;
    for (const key of Object.keys(src as Record<string, unknown>)) {
      const sv = (src as Record<string, unknown>)[key];
      if (sv === undefined) continue;
      const tv = (target as Record<string, unknown>)[key];
      if (
        (isPlainArray(sv) && isPlainArray(tv)) ||
        (isObject(sv) &&
          !isPlainArray(sv) &&
          isObject(tv) &&
          !isPlainArray(tv))
      ) {
        merge(tv as Record<string, unknown>, sv);
      } else {
        (target as Record<string, unknown>)[key] = sv;
      }
    }
  }
  return target;
}

/** lodash 4.17 `compareAscending` — verbatim (NaN/null/undefined/symbol). */
function compareAscending(value: unknown, other: unknown): number {
  if (value !== other) {
    const valIsDefined = value !== undefined;
    const valIsNull = value === null;
    const valIsReflexive = value === value;
    const valIsSymbol = typeof value === 'symbol';
    const othIsDefined = other !== undefined;
    const othIsNull = other === null;
    const othIsReflexive = other === other;
    const othIsSymbol = typeof other === 'symbol';

    if (
      (!othIsNull &&
        !othIsSymbol &&
        !valIsSymbol &&
        (value as number) > (other as number)) ||
      (valIsSymbol &&
        othIsDefined &&
        othIsReflexive &&
        !othIsNull &&
        !othIsSymbol) ||
      (valIsNull && othIsDefined && othIsReflexive && !othIsSymbol) ||
      (!valIsDefined && othIsReflexive && !othIsSymbol) ||
      !valIsReflexive
    ) {
      return 1;
    }
    if (
      (!valIsNull &&
        !valIsSymbol &&
        !othIsSymbol &&
        (value as number) < (other as number)) ||
      (othIsSymbol &&
        valIsDefined &&
        valIsReflexive &&
        !valIsNull &&
        !valIsSymbol) ||
      (othIsNull && valIsDefined && valIsReflexive && !valIsSymbol) ||
      (!othIsDefined && valIsReflexive && !valIsSymbol) ||
      !othIsReflexive
    ) {
      return -1;
    }
  }
  return 0;
}

type Iteratee = string | ((x: unknown) => unknown);

/** lodash `_.orderBy` — stable, non-array iteratees/orders wrapped. */
export function orderBy<T>(
  collection: T[],
  iteratees: Iteratee | Iteratee[],
  orders?: string | string[]
): T[] {
  if (collection == null) return [];
  const its = Array.isArray(iteratees)
    ? iteratees
    : iteratees == null
      ? []
      : [iteratees];
  const ords = Array.isArray(orders)
    ? orders
    : orders == null
      ? []
      : [orders];
  const fns = its.map(it =>
    typeof it === 'function' ? it : (x: unknown) => get(x, it)
  );
  const decorated = collection.map((value, index) => ({
    value,
    index,
    criteria: fns.map(f => f(value)),
  }));
  decorated.sort((a, b) => {
    for (let i = 0; i < a.criteria.length; i++) {
      const result = compareAscending(a.criteria[i], b.criteria[i]);
      if (result) {
        if (i >= ords.length) return result;
        return result * (ords[i] === 'desc' ? -1 : 1);
      }
    }
    return a.index - b.index;
  });
  return decorated.map(d => d.value);
}

/**
 * Faithful default `json-stable-stringify`: keys sorted lexically, recursively.
 * Only the `pretty && stable` WriteJSON path uses it.
 */
export function stableStringify(value: unknown, space?: number): string {
  const seen = new WeakSet<object>();
  const norm = (v: unknown): unknown => {
    if (v != null && typeof v === 'object') {
      if (seen.has(v as object)) throw new TypeError('Converting circular structure to JSON');
      seen.add(v as object);
      let out: unknown;
      if (Array.isArray(v)) {
        out = v.map(norm);
      } else {
        const sorted: Record<string, unknown> = {};
        for (const k of Object.keys(v as Record<string, unknown>).sort())
          sorted[k] = norm((v as Record<string, unknown>)[k]);
        out = sorted;
      }
      seen.delete(v as object);
      return out;
    }
    return v;
  };
  return JSON.stringify(norm(value), undefined, space);
}

/* ------------------------------------------------------------------------- *
 * Additional faithful lodash 4.17 slices used by the ported `Score` node's
 * metrics module (`core/metrics/*`). Same contract as the helpers above:
 * behaviour-identical to lodash so the parity-locked port stays bit-for-bit
 * (ranking order is the whole point of the Tibi flows). Ported verbatim from
 * lodash 4.17 internals — do not "tidy".
 * ------------------------------------------------------------------------- */

const objTag = (v: unknown): string => Object.prototype.toString.call(v);

export const isArray = Array.isArray;

export function isNumber(v: unknown): v is number {
  return (
    typeof v === 'number' ||
    (v != null && typeof v === 'object' && objTag(v) === '[object Number]')
  );
}

export function isString(v: unknown): v is string {
  return (
    typeof v === 'string' ||
    (v != null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      objTag(v) === '[object String]')
  );
}

export function isRegExp(v: unknown): v is RegExp {
  return v != null && typeof v === 'object' && objTag(v) === '[object RegExp]';
}

export function isFunction(v: unknown): boolean {
  const t = isObject(v) ? objTag(v) : '';
  return (
    t === '[object Function]' ||
    t === '[object AsyncFunction]' ||
    t === '[object GeneratorFunction]' ||
    t === '[object Proxy]'
  );
}

function isSymbol(v: unknown): boolean {
  return (
    typeof v === 'symbol' ||
    (v != null && typeof v === 'object' && objTag(v) === '[object Symbol]')
  );
}

/** lodash `_.isNaN`: a *number* that is not equal to itself. */
export function isNaN(value: unknown): boolean {
  return isNumber(value) && value != +(value as number);
}

const INFINITY = 1 / 0;
const MAX_INTEGER = 1.7976931348623157e308;
const NAN = 0 / 0;
const reIsBadHex = /^[-+]0x[0-9a-f]+$/i;
const reIsBinary = /^0b[01]+$/i;
const reIsOctal = /^0o[0-7]+$/i;

/** lodash `toNumber` (numeric + string paths — symbols/objects fall through). */
function toNumber(value: any): number {
  if (typeof value === 'number') return value;
  if (isSymbol(value)) return NAN;
  if (isObject(value)) {
    const valueOf = (value as { valueOf?: () => unknown }).valueOf;
    const other = typeof valueOf === 'function' ? valueOf.call(value) : value;
    value = isObject(other) ? other + '' : other;
  }
  if (typeof value !== 'string') {
    return value === 0 ? (value as number) : +(value as number);
  }
  value = value.replace(/^\s+|\s+$/g, '');
  const isBinary = reIsBinary.test(value);
  return isBinary || reIsOctal.test(value)
    ? parseInt(value.slice(2), isBinary ? 2 : 8)
    : reIsBadHex.test(value)
      ? NAN
      : +value;
}

/** lodash `toFinite`. */
function toFinite(value: any): number {
  if (!value) return value === 0 ? (value as number) : 0;
  const n = toNumber(value);
  if (n === INFINITY || n === -INFINITY) return (n < 0 ? -1 : 1) * MAX_INTEGER;
  return n === n ? n : 0;
}

/** lodash `toInteger`. */
function toInteger(value: any): number {
  const result = toFinite(value);
  const remainder = result % 1;
  return result === result ? (remainder ? result - remainder : result) : 0;
}

/** lodash `baseToString` (numbers/strings/arrays; preserves `-0`). */
function baseToString(value: any): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(baseToString) + '';
  if (isSymbol(value)) return String(value);
  const result = `${value}`;
  return result === '0' && 1 / (value as number) === -INFINITY ? '-0' : result;
}

/** lodash `_.round` — `createRound('round')` verbatim (exponent shifting). */
export function round(number: any, precision?: number): number {
  number = toNumber(number);
  precision = precision == null ? 0 : Math.min(toInteger(precision), 292);
  if (precision && isFinite(number as number)) {
    let pair = (baseToString(number) + 'e').split('e');
    const value = Math.round(
      Number(pair[0] + 'e' + (+pair[1] + precision))
    );
    pair = (baseToString(value) + 'e').split('e');
    return +(pair[0] + 'e' + (+pair[1] - precision));
  }
  return Math.round(number as number);
}

/** lodash `baseSum` with the identity iteratee (skips only `undefined`). */
export function sum(array: ReadonlyArray<number | undefined>): number {
  if (!(array && array.length)) return 0;
  let result: number | undefined;
  for (let i = 0; i < array.length; i++) {
    const current = array[i];
    if (current !== undefined) {
      result = result === undefined ? current : result + current;
    }
  }
  return result as number;
}

/** lodash `baseExtremum`: skips nil/NaN/symbols; `undefined` if none. */
function baseExtremum<T>(
  array: ReadonlyArray<T>,
  comparator: (a: unknown, b: unknown) => boolean
): T | undefined {
  let computed: unknown;
  let result: T | undefined;
  for (let i = 0; i < array.length; i++) {
    const current = array[i];
    if (
      current != null &&
      (computed === undefined
        ? current === current && !isSymbol(current)
        : comparator(current, computed))
    ) {
      computed = current;
      result = current;
    }
  }
  return result;
}

/** lodash `_.min` (baseLt). */
export function min<T>(array: ReadonlyArray<T>): T | undefined {
  return array && array.length
    ? baseExtremum(array, (a, b) => (a as number) < (b as number))
    : undefined;
}

/** lodash `_.max` (baseGt). */
export function max<T>(array: ReadonlyArray<T>): T | undefined {
  return array && array.length
    ? baseExtremum(array, (a, b) => (a as number) > (b as number))
    : undefined;
}

/** lodash `_.mapKeys` over own enumerable string keys. */
export function mapKeys<T>(
  object: Record<string, T>,
  iteratee: (value: T, key: string, object: Record<string, T>) => string
): Record<string, T> {
  const result: Record<string, T> = {};
  for (const key of Object.keys(object)) {
    result[iteratee(object[key], key, object)] = object[key];
  }
  return result;
}

/** lodash `_.sortBy` — stable, ascending, via the faithful `orderBy` above. */
export function sortBy<T>(
  collection: T[],
  iteratee: string | ((x: unknown) => unknown)
): T[] {
  return orderBy(collection, iteratee, 'asc');
}

const eq = (a: unknown, b: unknown): boolean =>
  a === b || (a !== a && b !== b);

/** lodash `_.sortedUniq` (adjacent SameValueZero dedupe of a sorted array). */
export function sortedUniq<T>(array: ReadonlyArray<T>): T[] {
  if (!(array && array.length)) return [];
  const result: T[] = [];
  let seen: T | undefined;
  let hasSeen = false;
  for (let i = 0; i < array.length; i++) {
    const value = array[i];
    if (!hasSeen || !eq(value, seen)) {
      hasSeen = true;
      seen = value;
      result.push(value);
    }
  }
  return result;
}

/** lodash `_.indexOf` (baseIndexOf — finds `NaN`, unlike `Array#indexOf`). */
export function indexOf<T>(
  array: ArrayLike<T> | null | undefined,
  value: T,
  fromIndex?: number
): number {
  const length = array == null ? 0 : array.length;
  if (!length) return -1;
  let index = fromIndex == null ? 0 : toInteger(fromIndex);
  if (index < 0) index = Math.max(length + index, 0);
  if (value === value) {
    for (let i = index; i < length; i++) if (array![i] === value) return i;
    return -1;
  }
  for (let i = index; i < length; i++) if (array![i] !== array![i]) return i;
  return -1;
}
