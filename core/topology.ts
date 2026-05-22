/**
 * Pure graph + store-shape helpers extracted from the runtime. The runtime
 * holds the state primitives (`edges`, the `store` map); the topology only
 * traverses them. Three concrete duplications collapse here: `plan` and
 * `topoOrder` differ only by start set, `downstream` is the mirrored
 * traversal, and the three `${id}/` store prefix scans are the same loop.
 */
import type { CocoonEdge } from '../src/lib/cocoon-file.ts';

/**
 * Topological order over the upstream cone(s) of `starts`. `plan(id)` is
 * `topoSort(edges, [id])`; the full graph order is `topoSort(edges,
 * Object.keys(file.nodes))`. Cycle-safe via the seen guard — a malformed
 * graph yields a still-deterministic but partial order.
 */
export function topoSort(
  edges: CocoonEdge[],
  starts: Iterable<string>
): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (n: string) => {
    if (seen.has(n)) return;
    seen.add(n);
    for (const e of edges) if (e.to === n) visit(e.from);
    order.push(n);
  };
  for (const s of starts) visit(s);
  return order;
}

/** All transitive downstream of `id`, exclusive of `id` itself. */
export function transitiveDownstream(
  edges: CocoonEdge[],
  id: string
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (n: string) => {
    for (const e of edges)
      if (e.from === n && !seen.has(e.to)) {
        seen.add(e.to);
        out.push(e.to);
        visit(e.to);
      }
  };
  visit(id);
  return out;
}

/** Every output port the store holds for `id`. The store uses `${id}/${port}`
 *  keys; this is the inverse projection. */
export function portMap(
  store: ReadonlyMap<string, unknown>,
  id: string
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const prefix = `${id}/`;
  for (const [k, v] of store)
    if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  return out;
}

/** Whether `id` has at least one output port in the store. Cheap presence
 *  check; returns on the first hit. */
export function hasOutputs(
  store: ReadonlyMap<string, unknown>,
  id: string
): boolean {
  const prefix = `${id}/`;
  for (const k of store.keys()) if (k.startsWith(prefix)) return true;
  return false;
}
