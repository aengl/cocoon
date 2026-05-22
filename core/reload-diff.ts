/**
 * Pure decision logic for selective reload. The runtime owns the mutation
 * (store clears, state writes, cache deletes); this module owns the
 * decisions. A reload's verdict per node is one of `preserve` / `stale` /
 * `reset`, derived from the compute signature plus the transitive upstream.
 */
import type { CocoonEdge, CocoonFile } from '../src/lib/cocoon-file.ts';
import type { NodeState } from '../src/lib/protocol.ts';

/** Deterministic structural key for cross-reload comparison. Object keys
 *  sorted; array order preserved (multi-edge `in:` is order-sensitive). */
export function stableKey(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(
          Object.keys(val as Record<string, unknown>)
            .sort()
            .map(k => [k, (val as Record<string, unknown>)[k]])
        )
      : val
  );
}

/**
 * Compute signature: everything in a node's YAML def that can change what
 * `process()` produces — `type`, `in:` (literal + edge), `out:` seeds.
 * Excluded so edits to them don't cost computed state: `editor` (position),
 * `?`/`description` (docs), `persist` (disk-only), control overlays (runtime).
 */
export function computeSig(
  def: { type?: unknown; in?: unknown; out?: unknown } | undefined
): string {
  return def
    ? stableKey({ type: def.type, in: def.in ?? null, out: def.out ?? null })
    : '∅';
}

export type Verdict = 'preserve' | 'stale' | 'reset';

export interface ReloadDiff {
  /** Verdict per node id present in the new file. */
  verdicts: Map<string, Verdict>;
  /** Node ids present in the old file but gone from the new one. */
  removed: string[];
  /** Cache files to delete before background hydrate runs. */
  cachesToDrop: string[];
  /** True if the diff cannot be applied selectively (nodeDirs/env shift). */
  globalReset: boolean;
}

function nodeDirsOf(file: CocoonFile): string[] {
  const v = (file as { nodeDirs?: unknown }).nodeDirs;
  return Array.isArray(v)
    ? v.filter((s): s is string => typeof s === 'string')
    : [];
}

/**
 * Decide what to do with each node on reload. Verdicts:
 *
 *  - `preserve` — self unchanged + all upstream unchanged. Keep the result.
 *  - `stale` — self unchanged but some upstream moved; node had a result.
 *    Mark stale (kept visible/amber), drop the persist cache.
 *  - `reset` — own def changed, new node, or had no result to keep. Drop
 *    output + cache; node goes back to `idle`.
 *
 * `globalReset` short-circuits the whole thing: a `nodeDirs:` or `env:`
 * shift can change resolution for every node, so anything that depends on
 * resolution must reset.
 */
export function diffReload(
  oldFile: CocoonFile,
  newFile: CocoonFile,
  edges: CocoonEdge[],
  priorStates: ReadonlyMap<string, NodeState>,
  persistEnabled: (id: string) => boolean
): ReloadDiff {
  const globalReset =
    stableKey(nodeDirsOf(oldFile)) !== stableKey(nodeDirsOf(newFile)) ||
    stableKey(oldFile.env) !== stableKey(newFile.env);

  const oldNodes = oldFile.nodes ?? {};
  const newNodes = newFile.nodes;
  const sigOld = new Map<string, string>();
  for (const [id, d] of Object.entries(oldNodes)) sigOld.set(id, computeSig(d));

  const selfChanged = (id: string) =>
    !(id in oldNodes) || computeSig(newNodes[id]) !== sigOld.get(id);

  // Transitive: hold iff this node and every node feeding it hold.
  const memo = new Map<string, boolean>();
  const preservable = (id: string): boolean => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    memo.set(id, false); // cycle guard against a malformed file
    let ok = id in oldNodes && !selfChanged(id);
    if (ok)
      for (const e of edges)
        if (e.to === id && !preservable(e.from)) {
          ok = false;
          break;
        }
    memo.set(id, ok);
    return ok;
  };

  const verdicts = new Map<string, Verdict>();
  const cachesToDrop: string[] = [];
  const removed = Object.keys(oldNodes).filter(id => !(id in newNodes));

  for (const id of Object.keys(newNodes)) {
    const prior = priorStates.get(id);
    const kept = prior?.status === 'done' || prior?.status === 'stale';

    if (selfChanged(id)) {
      if (id in oldNodes) cachesToDrop.push(id);
      verdicts.set(id, 'reset');
    } else if (preservable(id)) {
      verdicts.set(id, prior && kept ? 'preserve' : 'reset');
    } else if (prior && kept) {
      if (persistEnabled(id)) cachesToDrop.push(id);
      verdicts.set(id, 'stale');
    } else {
      cachesToDrop.push(id);
      verdicts.set(id, 'reset');
    }
  }

  return { verdicts, removed, cachesToDrop, globalReset };
}
