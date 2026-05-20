/**
 * Per-item error attribution for the core-owned collection nodes (`Map`,
 * `Filter`). When a user's `x => …` throws on one bad record out of many,
 * the bare message ("Cannot read properties of undefined") says nothing
 * about *which* record. These wrappers attach `{ index, record }` to the
 * thrown error via the `cocoonErrorAt` convention; `runtime.ts`'s catch
 * reads it and surfaces a digested version as `NodeState.errorAt`.
 *
 * Behaviour is otherwise identical to `Array.prototype.map`/`filter` (same
 * `(value, index, array)` callback args) — this only adds attribution, it
 * does not change what the nodes produce.
 */

interface ErrorAt {
  cocoonErrorAt?: { index: number; record: unknown };
}

/** `arr.map(fn)`, attributing a per-item throw to its index + record. */
export function trackedMap<T, R>(
  arr: T[],
  fn: (v: T, i: number, a: T[]) => R
): R[] {
  const out: R[] = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    try {
      out[i] = fn(arr[i], i, arr);
    } catch (err) {
      (err as ErrorAt).cocoonErrorAt = { index: i, record: arr[i] };
      throw err;
    }
  }
  return out;
}

/** `arr.filter(pred)`, attributing a per-item throw to its index + record. */
export function trackedFilter<T>(
  arr: T[],
  pred: (v: T, i: number, a: T[]) => unknown
): T[] {
  const keep = trackedMap(arr, pred);
  return arr.filter((_, i) => keep[i]);
}

/** Single-item form (legacy `Map` accepts a non-array `data`). */
export function trackedOne<T, R>(value: T, fn: (v: T) => R): R {
  try {
    return fn(value);
  } catch (err) {
    (err as ErrorAt).cocoonErrorAt = { index: 0, record: value };
    throw err;
  }
}
