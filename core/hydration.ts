/**
 * Background restore of persisted nodes (the `_cocoon_cache/<id>.json` files
 * `writePersistedCache` wrote). Extracted because the progress throttling,
 * the ENOENT-vs-real-error logging, the optimistic-running undo, and the
 * cross-caller dedupe with `runOne`'s persist fast-path are all internal
 * concerns — the runtime only needs `hydrate()` / `whenHydrated()` /
 * `restore(id)` / `forget(id)`.
 */
import { readPersistedCache, readCacheFingerprint } from './persist-cache.ts';
import { dedupePerKey } from './dedupe-per-key.ts';
import type { NodeState, NodeStatus } from '../src/lib/protocol.ts';

const itemCount = (v: unknown) =>
  Array.isArray(v) ? v.length : v === undefined || v === null ? 0 : 1;

export interface HydrationDeps {
  cachePath(id: string): string;
  hasNode(id: string): boolean;
  /** The runtime's current generation. A late-finishing restore observing a
   *  stale generation must NOT write into the moved-on graph. */
  generation(): number;
  getStatus(id: string): NodeStatus | undefined;
  setState(id: string, patch: Partial<NodeState>): void;
  setStore(id: string, port: string, value: unknown): void;
  seedStaticOut(id: string): Record<string, unknown>;
  controlPatch(id: string): Partial<NodeState>;
  controlStatePatch(id: string): Promise<Partial<NodeState>>;
  topoOrder(): string[];
  persistEnabled(id: string): boolean;
  /** Current on-disk module fingerprint (closure mtime) for the node's type.
   *  A cache is valid only if it was written under this same fingerprint;
   *  `undefined` when the type is unknown/unresolvable. */
  moduleFingerprint(id: string): Promise<number | undefined>;
}

export class Hydration {
  /** Concurrent-restore dedupe: hydrate and runOne's fast-path can both want
   *  the same node; a multi-hundred-MiB cache must not be parsed twice. */
  private inFlight = new Map<string, Promise<boolean>>();
  /** Bookkeeping for `whenHydrated()`. Always resolved between hydrate calls. */
  private current: Promise<void> = Promise.resolve();
  private deps: HydrationDeps;

  constructor(deps: HydrationDeps) {
    this.deps = deps;
  }

  /**
   * Restore every persisted node from its cache. Sequential (one large cache
   * is already heap-heavy; parallel parses risk OOM) and in topological order
   * (so a node's upstream is seeded when its own cache lands, letting a
   * downstream re-pull memoise it). Skips nodes no longer `idle`. Bails once
   * a newer generation supersedes us.
   */
  hydrate(): Promise<void> {
    const gen = this.deps.generation();
    this.current = this.run(gen);
    return this.current;
  }

  whenHydrated(): Promise<void> {
    return this.current;
  }

  forget(id: string): void {
    this.inFlight.delete(id);
  }

  private async run(gen: number): Promise<void> {
    for (const id of this.deps.topoOrder()) {
      if (gen !== this.deps.generation()) return;
      if (
        this.deps.persistEnabled(id) &&
        this.deps.getStatus(id) === 'idle'
      )
        await this.restore(id, gen);
    }
  }

  /**
   * Restore one node. De-dupes concurrent callers (hydrate + runOne's
   * fast-path). `gen` is the caller's observed generation — a result parsed
   * under a stale generation is discarded, not resurrected.
   */
  restore(id: string, gen: number = this.deps.generation()): Promise<boolean> {
    return dedupePerKey(this.inFlight, id, () => this.doRestore(id, gen));
  }

  private async doRestore(id: string, gen: number): Promise<boolean> {
    // Module-source guard. The cache validity check is otherwise keyed only on
    // the YAML compute-signature (handled by reload-diff), so an edited node
    // module whose YAML and upstream are unchanged would be silently served
    // from the stale cache. Reject when the cache's stored fingerprint differs
    // from the module's current closure mtime — including a legacy cache with
    // no fingerprint (`stored === undefined`). The caller recomputes and the
    // fresh cache is rewritten with the new fingerprint. This runs before the
    // optimistic `running` flip below, so a miss leaves state untouched (idle
    // under hydrate; the fast-path's own `running` for `runOne` to resolve).
    // A cheap head-read avoids parsing a multi-hundred-MiB payload to reject it.
    const expected = await this.deps.moduleFingerprint(id);
    if (expected !== undefined) {
      const stored = await readCacheFingerprint(this.deps.cachePath(id));
      if (stored !== expected) {
        if (stored !== undefined)
          console.error(
            `[${id}] persist cache predates a node-code change ` +
              `(cache ${stored} ≠ module ${expected}) — recomputing`
          );
        return false;
      }
    }

    // Only flip the status when WE own the lifecycle (prior was `idle` — the
    // hydrate case). The `runOne` fast-path already set `running` itself; we
    // still feed it byte progress below but don't touch its terminal state.
    const tookRunning =
      gen === this.deps.generation() &&
      this.deps.hasNode(id) &&
      this.deps.getStatus(id) === 'idle';
    if (tookRunning)
      this.deps.setState(id, {
        status: 'running',
        progress: 'Restoring from cache…',
        summary: undefined,
        error: undefined,
        errorStack: undefined,
        durationMs: undefined,
        restoredFromCache: undefined,
      });
    const t0 = performance.now();
    let lastEmit = 0;
    const onBytes = (total: number) => {
      if (gen !== this.deps.generation()) return;
      const now = Date.now();
      if (now - lastEmit < 150) return;
      lastEmit = now;
      this.deps.setState(id, {
        status: 'running',
        progress: `Restoring from cache… ${(total / 1048576).toFixed(1)} MB`,
      });
    };
    try {
      const cached = await readPersistedCache(
        this.deps.cachePath(id),
        onBytes
      );
      // A reload cleared the store / dropped this node while we streamed —
      // don't write into a graph that has moved on.
      if (gen !== this.deps.generation() || !this.deps.hasNode(id))
        return false;
      const ports: Record<string, number> = {};
      for (const [p, v] of Object.entries(cached)) {
        this.deps.setStore(id, p, v);
        ports[p] = itemCount(v);
      }
      // Re-seed static `out:` literals so a downstream reader still resolves.
      for (const [p, v] of Object.entries(this.deps.seedStaticOut(id)))
        ports[p] = itemCount(v);
      this.deps.setState(id, {
        status: 'done',
        summary: `Restored from cache (${Object.entries(ports)
          .map(([p, n]) => `${p}: ${n}`)
          .join(', ')})`,
        ports,
        progress: undefined,
        // Only stamp when we own the lifecycle. When `runOne`'s fast-path
        // drove the transition, IT stamps duration/restoredFromCache so the
        // measurement reflects the caller's wall clock, not ours.
        ...(tookRunning
          ? {
              durationMs: performance.now() - t0,
              restoredFromCache: this.deps.cachePath(id),
            }
          : {}),
        ...this.deps.controlPatch(id),
      });
      this.deps.setState(id, await this.deps.controlStatePatch(id));
      return true;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e?.code === 'ENOENT') {
        console.error(`[${id}] no persist cache — will compute on run`);
      } else {
        console.error(
          `[${id}] persist cache present but unrestorable — will recompute` +
            ` (${e?.message ?? String(err)})`
        );
      }
      // Undo only OUR optimistic `running` flip. A `runOne` fast-path's own
      // `running` (tookRunning === false) is left for it to resolve.
      if (
        tookRunning &&
        gen === this.deps.generation() &&
        this.deps.getStatus(id) === 'running'
      )
        this.deps.setState(id, { status: 'idle', progress: undefined });
      return false;
    }
  }
}
