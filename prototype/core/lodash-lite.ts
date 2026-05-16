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
