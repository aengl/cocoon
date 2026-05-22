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
  const p = work().finally(() => map.delete(key));
  map.set(key, p);
  return p;
}
