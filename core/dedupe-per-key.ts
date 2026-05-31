/**
 * Per-key promise dedupe. Used wherever two callers may race for the same
 * unit of work and we want them to share one in-flight promise: the hydrate
 * background pass + a runOne fast-path arriving at the same node, or two
 * overlapping plans sharing a transitive upstream.
 */
export function dedupePerKey<K, V>(
  map: Map<K, Promise<V>>,
  key: K,
  work: () => Promise<V>
): Promise<V> {
  const existing = map.get(key);
  if (existing) return existing;
  // Identity-guarded cleanup: only evict the entry if it is still THIS promise.
  // A reload can abandon an in-flight run by deleting its entry and a fresh run
  // may take the slot before the old one settles; an unguarded `delete(key)`
  // from the stale promise would then wipe the new run's entry.
  const p = work().finally(() => {
    if (map.get(key) === p) map.delete(key);
  });
  map.set(key, p);
  return p;
}
